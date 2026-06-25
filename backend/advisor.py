"""backend/advisor.py --- environment-first optimization engine.

Takes the generated mock (the as-built baseline) and produces in-depth upgrade
recommendations, each quantified in the unit that matters most here: tonnes of
CO2 avoided per year. Recommendations are always computed deterministically so
the app works offline; when an Azure AI Foundry model is configured it also
writes the executive narrative grounded in the very same numbers.
"""

from __future__ import annotations

import json

from backend.ai_client import ai_available, ai_complete
from backend.generator import (
    BASE_GRID_CARBON_KG_PER_KWH,
    CLIMATE_PROFILES,
    FREE_COOLING_COP_GAIN,
    HOURS_PER_YEAR,
    cooling_profile,
)
from backend.schemas import (
    CombinedSavings,
    DatacenterMock,
    DatacenterSpec,
    OptimizationReport,
    Recommendation,
)

GAS_HEAT_CARBON_KG_PER_KWH = 0.20  # carbon of the gas heating that reused heat displaces
TREE_KG_CO2_PER_YEAR = 22.0  # CO2 a mature tree sequesters per year


def _mk(
    rid: str,
    title: str,
    category: str,
    summary: str,
    detail: str,
    *,
    effort: str,
    kwh_saved: float = 0.0,
    co2_saved_tonnes: float = 0.0,
    cost_saved_usd: float = 0.0,
    water_saved_liters: float = 0.0,
    capex_usd: float = 0.0,
    ai_generated: bool = False,
) -> Recommendation:
    payback = None
    if cost_saved_usd > 0 and capex_usd > 0:
        payback = round(capex_usd / cost_saved_usd, 1)
    return Recommendation(
        id=rid,
        title=title,
        category=category,
        priority="Low",  # filled in later, once all numbers are known
        summary=summary,
        detail=detail,
        annual_kwh_saved=round(kwh_saved, 0),
        annual_co2_saved_tonnes=round(co2_saved_tonnes, 1),
        annual_cost_saved_usd=round(cost_saved_usd, 0),
        water_saved_liters=round(water_saved_liters, 0),
        capex_estimate_usd=round(capex_usd, 0),
        payback_years=payback,
        effort=effort,
        ai_generated=ai_generated,
    )


def deterministic_recommendations(spec: DatacenterSpec, mock: DatacenterMock) -> list[Recommendation]:
    cool = cooling_profile(spec)
    clim = CLIMATE_PROFILES[spec.climate.value]
    ci = mock.annual.carbon_intensity_kg_per_kwh
    price = mock.annual.price_usd_per_kwh

    cooling_kwh = mock.facility.cooling_load_kw * HOURS_PER_YEAR
    it_kwh = mock.facility.it_load_kw * HOURS_PER_YEAR
    overhead_kwh = mock.facility.overhead_kw * HOURS_PER_YEAR
    total_kwh = mock.annual.energy_kwh
    cop = mock.facility.cop

    air_like = spec.cooling_type.value in ("crac_air", "crah_chilled", "free_air", "rear_door")
    recs: list[Recommendation] = []

    # 1) Raise the cold-aisle setpoint (ASHRAE A1 allows up to 27 C). -------- #
    if air_like and spec.setpoint_c < 24.5:
        delta = min(24.5 - spec.setpoint_c, 4.0)
        frac = min(0.04 * delta, 0.16)
        kwh = cooling_kwh * frac
        recs.append(_mk(
            "setpoint", f"Raise supply setpoint to {spec.setpoint_c + delta:.0f} C", "Cooling",
            f"Warming the cold aisle by {delta:.0f} C lifts the chiller COP and trims cooling energy ~{frac*100:.0f}%.",
            (
                f"The facility runs a {spec.setpoint_c:.0f} C supply setpoint, well below the ASHRAE "
                f"A1 recommended envelope (up to 27 C inlet). Modern servers tolerate warmer air, so "
                f"every degree of setpoint relief raises the coefficient of performance and lets the "
                f"plant spend less electricity moving the same heat. Stage the increase a degree at a "
                f"time while watching the hottest racks; it is the cheapest carbon you will ever cut."
            ),
            effort="Low", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=1500.0,
        ))

    # 2) Add an air-side economizer where the climate allows free cooling. --- #
    if not cool["free_cooling"] and clim["free_cooling_pct"] > 0.2:
        fcp = clim["free_cooling_pct"]
        new_cop = cool["base_cop"] + FREE_COOLING_COP_GAIN * fcp
        frac = max(0.0, 1.0 - cool["base_cop"] / new_cop)
        kwh = cooling_kwh * frac
        recs.append(_mk(
            "economizer", "Install air-side economizer (free cooling)", "Cooling",
            f"The {clim['label'].lower()} climate offers free cooling ~{fcp*100:.0f}% of the year, cutting cooling energy ~{frac*100:.0f}%.",
            (
                f"At {clim['outside_air_c']:.0f} C average outside air this site can reject heat directly "
                f"to ambient for roughly {fcp*100:.0f}% of the year. Adding economizer dampers and controls "
                f"lets the mechanical chillers idle whenever it is cool enough outside, which is the single "
                f"largest structural cut available to an all-mechanical plant. Pair it with raised setpoints "
                f"to widen the free-cooling window further."
            ),
            effort="High", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=mock.facility.it_load_kw * 120.0,
        ))

    # 3) Hot/cold aisle containment for air-cooled halls. -------------------- #
    if spec.cooling_type.value in ("crac_air", "crah_chilled"):
        frac = 0.10
        kwh = cooling_kwh * frac
        recs.append(_mk(
            "containment", "Deploy hot/cold aisle containment", "Cooling",
            "Sealing aisles stops hot/cold air mixing and recovers ~10% of cooling energy.",
            (
                "Without containment, CRAH units over-supply cold air to compensate for recirculation "
                "and bypass. Blanking panels, brush grommets and aisle-end doors separate the air streams "
                "so fans can slow down and the return temperature rises (which itself improves chiller "
                "efficiency). It is a low-disruption retrofit with one of the best paybacks in the room."
            ),
            effort="Medium", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=mock.facility.total_racks * 800.0,
        ))

    # 4) Liquid cooling for dense racks still on air. ------------------------ #
    if spec.rack_density_kw >= 20 and spec.cooling_type.value in ("crac_air", "crah_chilled", "free_air"):
        target_cop = 7.5
        frac = max(0.0, 1.0 - cop / target_cop)
        kwh = cooling_kwh * frac
        recs.append(_mk(
            "liquid", "Retrofit direct-to-chip liquid cooling", "Cooling",
            f"At {spec.rack_density_kw:.0f} kW/rack, liquid cooling removes heat far more efficiently than air (~{frac*100:.0f}% cooling cut).",
            (
                f"Air struggles above ~20 kW per rack and this design runs {spec.rack_density_kw:.0f} kW. "
                f"Direct-to-chip cold plates capture 70-80% of the heat into warm water that needs little "
                f"or no mechanical chilling, slashing fan and compressor energy and unlocking far higher "
                f"density per square foot. It is capital-intensive but transformational for both efficiency "
                f"and the heat-reuse opportunity below."
            ),
            effort="High", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=mock.facility.it_load_kw * 350.0,
        ))

    # 5) Decarbonize supply (PPA / on-site renewables) -- the biggest lever. - #
    if spec.renewable_pct < 85:
        target = 90.0 if spec.climate.value in ("hot_arid", "temperate", "cold", "continental") else 75.0
        delta_pct = max(0.0, target - spec.renewable_pct)
        co2 = total_kwh * BASE_GRID_CARBON_KG_PER_KWH * (delta_pct / 100.0) / 1000.0
        recs.append(_mk(
            "renewable", f"Procure {target:.0f}% clean power (PPA + on-site solar)", "Renewable",
            f"Moving from {spec.renewable_pct:.0f}% to {target:.0f}% renewable supply avoids the most CO2 of any single action.",
            (
                f"Efficiency shrinks the kWh; clean supply decarbonizes whatever remains. Signing a power "
                f"purchase agreement and adding on-site solar to reach {target:.0f}% renewable cuts grid "
                f"carbon directly without touching a single server. For an environment-first program this is "
                f"the headline move \u2014 it attacks emissions at the source and is often cost-neutral or "
                f"cost-saving over the contract term."
            ),
            effort="Medium", co2_saved_tonnes=co2, capex_usd=0.0,
        ))

    # 6) Consolidate / power-cap an under-utilized fleet. -------------------- #
    if spec.avg_utilization < 0.5:
        frac = min(0.15, (0.5 - spec.avg_utilization) * 0.4)
        kwh = (it_kwh + cooling_kwh + overhead_kwh) * frac
        recs.append(_mk(
            "consolidation", "Consolidate workloads and power-cap idle nodes", "Workload",
            f"At {spec.avg_utilization*100:.0f}% average load, packing jobs and idling spare racks cuts ~{frac*100:.0f}% of total energy.",
            (
                f"Idle and lightly loaded servers still draw {int(0.375*100)}%+ of nameplate power for no "
                f"useful work. Bin-packing workloads onto fewer racks, enabling CPU power management, and "
                f"powering down or sleeping the freed capacity reduces IT draw \u2014 and the cooling and "
                f"power-chain losses that ride on top of it. This is mostly software and orchestration, so "
                f"the carbon comes cheap."
            ),
            effort="Medium", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=25000.0,
        ))

    # 7) Waste-heat reuse where there is a heat demand nearby. --------------- #
    if spec.climate.value in ("cold", "temperate", "continental"):
        recovered = cooling_kwh * 0.40
        co2 = recovered * GAS_HEAT_CARBON_KG_PER_KWH / 1000.0
        recs.append(_mk(
            "heatreuse", "Capture and export waste heat", "HeatReuse",
            "Pipe rejected heat to district heating or neighboring buildings to displace fossil heating.",
            (
                "Every watt of IT becomes heat that is normally thrown away. In a heating climate that heat "
                "has real value: routed to a district-heating loop or an adjacent campus it displaces gas "
                "boilers, cutting emissions that sit *outside* the data center's own meter. Liquid cooling "
                "makes the heat hot enough to be useful, so this pairs naturally with the liquid retrofit."
            ),
            effort="High", co2_saved_tonnes=co2,
            cost_saved_usd=recovered * price * 0.3, capex_usd=mock.facility.it_load_kw * 200.0,
        ))

    # 8) Cut cooling water in water-stressed regions. ------------------------ #
    if cool["water_wue"] > 1.0:
        water_saved = mock.annual.water_liters * 0.7
        priority_climate = clim["water_stress"]
        recs.append(_mk(
            "water", "Switch to closed-loop / adiabatic cooling", "Water",
            f"Eliminate ~70% of evaporative water use ({water_saved/1_000_000:.1f} ML/yr).",
            (
                f"The current {cool['label'].lower()} plant evaporates water to reject heat \u2014 about "
                f"{mock.annual.water_liters/1_000_000:.1f} million liters a year. "
                + ("In this water-stressed region that is an environmental liability. " if priority_climate else "")
                + "Closed-loop dry coolers or adiabatic assist (spraying only on the hottest days) keep the "
                "efficiency while returning most of that water to the community. Expect a small energy "
                "trade-off that the setpoint and economizer measures more than offset."
            ),
            effort="Medium", water_saved_liters=water_saved,
            capex_usd=mock.facility.it_load_kw * 60.0,
        ))

    # 9) Replace legacy CRAC with chilled-water CRAH. ------------------------ #
    if spec.cooling_type.value == "crac_air":
        frac = 1.0 - 2.8 / 4.0
        kwh = cooling_kwh * frac
        recs.append(_mk(
            "crah", "Replace legacy CRAC with chilled-water plant", "Cooling",
            "Modern chilled-water CRAH with variable-speed pumps/fans roughly doubles cooling COP.",
            (
                "Legacy direct-expansion CRAC units are the least efficient way to cool a hall. A "
                "chilled-water plant with variable-speed fans and pumps, plus a waterside economizer, lifts "
                "effective COP from ~2.8 toward 4+ and is the foundation every other cooling measure builds "
                "on. Plan it as the anchor capital project of the retrofit."
            ),
            effort="High", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=mock.facility.it_load_kw * 180.0,
        ))

    # 10) DCIM + AI-driven dynamic control (the AI tie-in). ------------------ #
    frac = 0.10
    kwh = (cooling_kwh + overhead_kwh) * frac
    recs.append(_mk(
        "controls", "Deploy DCIM + AI dynamic cooling control", "Controls",
        "Continuously optimize setpoints, fan speeds and workload placement with a learning controller (~10% off cooling + overhead).",
        (
            "Static setpoints leave efficiency on the table because load, weather and prices change minute "
            "to minute. A DCIM platform feeding an AI controller can trim fan speeds, float the setpoint to "
            "the safe maximum, and steer workloads toward the coolest, cleanest capacity in real time \u2014 "
            "holding zero thermal violations while shaving another ~10% off cooling and power-chain overhead. "
            "It also gives you the live telemetry every other measure here needs to prove its savings."
        ),
        effort="Medium", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
        cost_saved_usd=kwh * price, capex_usd=40000.0,
    ))

    # 11) Tidy up the power chain on 2N sites. ------------------------------- #
    if spec.redundancy == "2N":
        kwh = it_kwh * 0.04
        recs.append(_mk(
            "powerchain", "Modernize UPS / power chain (eco-mode)", "Power",
            "Modular eco-mode UPS cut double-conversion losses on the 2N topology (~4% of IT energy).",
            (
                "Full 2N redundancy is safe but lossy: every watt passes through conversion stages twice. "
                "Modern modular UPS with eco/line-interactive modes and right-sized transformers recover "
                "much of that loss without compromising availability, shrinking the overhead slice of PUE."
            ),
            effort="Medium", kwh_saved=kwh, co2_saved_tonnes=kwh * ci / 1000.0,
            cost_saved_usd=kwh * price, capex_usd=mock.facility.it_load_kw * 90.0,
        ))

    return recs


def _assign_priorities(recs: list[Recommendation], annual_co2: float, water_stress: bool) -> None:
    for r in recs:
        if r.annual_co2_saved_tonnes >= 0.08 * annual_co2:
            r.priority = "High"
        elif r.annual_co2_saved_tonnes >= 0.025 * annual_co2:
            r.priority = "Medium"
        else:
            r.priority = "Low"
        if r.category == "Water" and water_stress and r.priority == "Low":
            r.priority = "Medium"


def _combine(mock: DatacenterMock, recs: list[Recommendation]) -> CombinedSavings:
    cooling_kwh = mock.facility.cooling_load_kw * HOURS_PER_YEAR
    overhead_kwh = mock.facility.overhead_kw * HOURS_PER_YEAR
    total_kwh = mock.annual.energy_kwh
    annual_co2 = mock.annual.co2_tonnes
    annual_cost = mock.annual.cost_usd
    annual_water = mock.annual.water_liters

    # Cap aggregates so overlapping measures never claim more than is physical.
    kwh = min(sum(r.annual_kwh_saved for r in recs), 0.55 * total_kwh)
    co2 = min(sum(r.annual_co2_saved_tonnes for r in recs), 0.92 * annual_co2) if annual_co2 else 0.0
    cost = min(sum(r.annual_cost_saved_usd for r in recs), 0.60 * annual_cost) if annual_cost else 0.0
    water = min(sum(r.water_saved_liters for r in recs), annual_water)

    pct_energy = (kwh / total_kwh * 100.0) if total_kwh else 0.0
    pct_co2 = (co2 / annual_co2 * 100.0) if annual_co2 else 0.0

    # Efficiency measures shrink the non-IT overhead -> lower PUE.
    overhead_reduction = min(0.6, kwh / (cooling_kwh + overhead_kwh)) if (cooling_kwh + overhead_kwh) else 0.0
    projected_pue = max(1.05, 1.0 + (mock.facility.pue - 1.0) * (1.0 - overhead_reduction))

    return CombinedSavings(
        annual_kwh_saved=round(kwh, 0),
        annual_co2_saved_tonnes=round(co2, 1),
        annual_cost_saved_usd=round(cost, 0),
        water_saved_liters=round(water, 0),
        pct_energy_reduction=round(pct_energy, 1),
        pct_co2_reduction=round(pct_co2, 1),
        projected_pue=round(projected_pue, 3),
        trees_equivalent=int(co2 * 1000.0 / TREE_KG_CO2_PER_YEAR),
    )


def _deterministic_summary(spec: DatacenterSpec, mock: DatacenterMock, c: CombinedSavings, top: Recommendation | None) -> str:
    lead = (
        f"{mock.facility.name} draws {mock.facility.total_load_mw:.2f} MW at a PUE of "
        f"{mock.facility.pue:.2f}, emitting roughly {mock.annual.co2_tonnes:,.0f} tonnes of CO2 a year. "
    )
    body = (
        f"Prioritizing the environment, the recommended program can avoid about "
        f"{c.annual_co2_saved_tonnes:,.0f} tonnes of CO2 per year (\u2248{c.pct_co2_reduction:.0f}% lower) "
        f"and cut {c.annual_kwh_saved/1_000_000:.1f} GWh of electricity, pulling PUE toward "
        f"{c.projected_pue:.2f} \u2014 the equivalent of about {c.trees_equivalent:,} trees. "
    )
    tail = (
        f"Start with \u201c{top.title}\u201d for the largest single carbon reduction." if top else ""
    )
    return lead + body + tail


_VALID_CATEGORIES = {"Cooling", "Renewable", "Workload", "HeatReuse", "Water", "Power", "Controls"}
_VALID_EFFORT = {"Low", "Medium", "High"}
_VALID_PRIORITY = {"High", "Medium", "Low"}


def _extract_json(text: str | None) -> dict | None:
    """Best-effort: pull the first JSON object out of an LLM reply (tolerates
    code fences or surrounding prose)."""
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        obj = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def _ai_enrich(
    spec: DatacenterSpec,
    mock: DatacenterMock,
    recs: list[Recommendation],
    c: CombinedSavings,
) -> tuple[str | None, list[Recommendation], bool]:
    """Hybrid AI step (one round-trip).

    The AI may (1) rewrite the title/summary/detail of the already-quantified
    recommendations, (2) propose a few additional *qualitative* measures, and
    (3) write the executive summary. It never touches a number: rewrites change
    text only, and the extra measures carry no quantified savings. Mutates the
    text fields of ``recs`` in place. Returns
    ``(executive_summary, additional_recs, ai_used)`` and degrades to
    ``(None, [], False)`` on any failure.
    """
    context = {
        "spec": spec.model_dump(),
        "facility": mock.facility.model_dump(),
        "annual": mock.annual.model_dump(),
        "combined_savings": c.model_dump(),
        "recommendations": [
            {
                "id": r.id,
                "category": r.category,
                "current_title": r.title,
                "co2_saved_tonnes": r.annual_co2_saved_tonnes,
                "kwh_saved": r.annual_kwh_saved,
                "water_saved_liters": r.water_saved_liters,
            }
            for r in recs
        ],
    }
    system = (
        "You are a senior data-center sustainability engineer. The operator's #1 priority is "
        "environmental impact (CO2, then energy, then water); cost is a secondary benefit. You are "
        "given a facility analysis and a list of ALREADY-QUANTIFIED recommendations. The numeric "
        "savings are authoritative and FIXED -- never change, restate, or invent any numbers. "
        "Tasks: (1) For each recommendation 'id', rewrite 'title', 'summary' (one sentence) and "
        "'detail' (2-4 sentences) so they are specific and tailored to THIS facility's spec, "
        "climate and cooling. (2) Propose up to 3 ADDITIONAL strategic or qualitative measures the "
        "rule engine did not cover (e.g. clean-power procurement, siting, embodied carbon, "
        "circular hardware reuse, monitoring); these are narrative-only and must contain NO "
        "numbers. (3) Write 'executive_summary' (120-180 words) grounded ONLY in the provided "
        "numbers, leading with the carbon and energy outcome. Respond with STRICT JSON ONLY (no "
        "markdown) of the form: {\"executive_summary\": str, \"rewrites\": [{\"id\": str, "
        "\"title\": str, \"summary\": str, \"detail\": str}], \"additional\": [{\"title\": str, "
        "\"category\": str, \"priority\": \"High|Medium|Low\", \"effort\": \"Low|Medium|High\", "
        "\"summary\": str, \"detail\": str}]}. Allowed category values: Cooling, Renewable, "
        "Workload, HeatReuse, Water, Power, Controls."
    )
    user = "Facility and recommendations as JSON:\n\n" + json.dumps(context, indent=2)

    data = _extract_json(ai_complete(system, user, temperature=0.5, max_tokens=2000))
    if data is None:
        return None, [], False

    # (1) Apply text-only rewrites to the existing (quantified) recs.
    by_id = {r.id: r for r in recs}
    applied = 0
    for rw in data.get("rewrites") or []:
        if not isinstance(rw, dict):
            continue
        target = by_id.get(rw.get("id"))
        if target is None:
            continue
        for field in ("title", "summary", "detail"):
            val = rw.get(field)
            if isinstance(val, str) and val.strip():
                setattr(target, field, val.strip())
                applied += 1

    # (2) Build additional qualitative recs (no numbers, clearly AI-flagged).
    additional: list[Recommendation] = []
    for i, item in enumerate(data.get("additional") or []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        summary = str(item.get("summary") or "").strip()
        detail = str(item.get("detail") or "").strip()
        if not title or not summary:
            continue
        category = item.get("category") if item.get("category") in _VALID_CATEGORIES else "Controls"
        effort = item.get("effort") if item.get("effort") in _VALID_EFFORT else "Medium"
        priority = item.get("priority") if item.get("priority") in _VALID_PRIORITY else "Medium"
        rec = _mk(
            f"ai_{i + 1}", title, category, summary, detail or summary,
            effort=effort, ai_generated=True,
        )
        rec.priority = priority
        additional.append(rec)

    summary_text = data.get("executive_summary")
    summary_text = summary_text.strip() if isinstance(summary_text, str) and summary_text.strip() else None

    ai_used = bool(summary_text or additional or applied)
    return summary_text, additional, ai_used


def generate_report(spec: DatacenterSpec, mock: DatacenterMock) -> OptimizationReport:
    recs = deterministic_recommendations(spec, mock)
    water_stress = CLIMATE_PROFILES[spec.climate.value]["water_stress"]
    _assign_priorities(recs, mock.annual.co2_tonnes or 1.0, water_stress)

    # Environment-first ordering: most CO2 avoided, then energy, then water.
    recs.sort(
        key=lambda r: (r.annual_co2_saved_tonnes, r.annual_kwh_saved, r.water_saved_liters),
        reverse=True,
    )
    combined = _combine(mock, recs)

    # Hybrid AI: the deterministic numbers above are authoritative. When a model
    # is configured the AI rewrites each recommendation's narrative for this
    # specific facility, proposes extra qualitative measures, and writes the
    # executive summary. Numbers never depend on the AI being present.
    ai_summary: str | None = None
    ai_used = False
    if ai_available():
        ai_summary, additional, ai_used = _ai_enrich(spec, mock, recs, combined)
        if additional:
            # Qualitative extras carry no quantified savings, so the combined
            # totals (computed above) stay physically grounded.
            recs = recs + additional

    summary = ai_summary or _deterministic_summary(spec, mock, combined, recs[0] if recs else None)

    return OptimizationReport(
        ai_used=ai_used,
        executive_summary=summary.strip(),
        combined=combined,
        recommendations=recs,
    )
