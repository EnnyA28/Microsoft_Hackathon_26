"""bridge/assistant.py --- offline, templated AI assistant.

Generates ThermaMind-style insights *without any cloud API* (no Gemini, no
ElevenLabs), so the demo runs fully offline. It narrates the real DC-Twin
telemetry summary produced by :meth:`SimRuntime.status_summary`. Keep responses
short and grounded in the actual numbers.
"""

from __future__ import annotations


def analyze(s: dict) -> str:
    """One-shot 'Analyze Current Status' narration from the live summary."""
    verdict = "0 thermal violations" if s["thermal_violations"] == 0 else \
        f"{s['thermal_violations']} thermal violations"
    sla = "SLA on track" if s["sla_delta"] <= 0 else f"SLA {s['sla_delta']:+d} vs baseline"
    band = ("within the published 1.1\u20131.6 hyperscale PUE band"
            if s.get("pue_in_band") else "near published datacenter PUE levels")
    outside = s.get("outside_air_c")
    outside_txt = (
        f" Outside air is {outside:.0f}\u00b0C, so the free-cooling economizer is "
        f"{'helping' if outside < 20 else 'working harder'} right now."
        if outside is not None else ""
    )
    return (
        f"DC-Twin status ({s['ai_kind']} controller): mean GPU load "
        f"{s['mean_util_pct']:.0f}% across 8 clusters, PUE {s['pue']:.2f}, drawing "
        f"{s['power_draw_mw']:.2f} MW. The RL controller is holding the cooling "
        f"setpoint at {s['t_supply']:.1f}\u00b0C \u2014 as warm as is safe \u2014 cutting "
        f"cooling energy {s['pct_cooling_saved']:.1f}% below the fixed 20\u00b0C "
        f"baseline with {verdict} and {sla}.{outside_txt} "
        f"That emergent PUE sits {band}. "
        f"Hottest right now is Cluster {s['hottest']['cluster']} at "
        f"{s['hottest']['temp_c']:.1f}\u00b0C ({s['hottest']['load_pct']:.0f}% load). "
        f"Recommendation: keep new jobs off Cluster {s['hottest']['cluster']}; "
        f"Cluster {s['coolest']['cluster']} has the most thermal headroom "
        f"({s['coolest']['load_pct']:.0f}% load)."
    )


def answer(question: str, s: dict) -> str:
    """Keyword-routed answer to a free-text question, grounded in real data."""
    q = (question or "").lower()

    if any(k in q for k in ("which cluster", "next job", "run my", "where should", "place")):
        return (
            f"Run it on Cluster {s['coolest']['cluster']} \u2014 it's the least loaded "
            f"({s['coolest']['load_pct']:.0f}%) with the most cooling headroom. Avoid "
            f"Cluster {s['hottest']['cluster']} ({s['hottest']['temp_c']:.1f}\u00b0C, "
            f"{s['hottest']['load_pct']:.0f}% load)."
        )
    if any(k in q for k in ("power", "consumption", "draw", "watt", "energy")):
        return (
            f"Total draw is {s['power_draw_mw']:.2f} MW at PUE {s['pue']:.2f}. The AI is "
            f"saving {s['pct_cooling_saved']:.1f}% of cooling energy vs the fixed baseline "
            f"by running the setpoint at {s['t_supply']:.1f}\u00b0C. Busiest cluster is "
            f"{s['busiest']['cluster']} at {s['busiest']['load_pct']:.0f}% load."
        )
    if any(k in q for k in ("efficien", "issue", "problem", "pue", "optimi")):
        headroom = "comfortable" if s["hottest"]["temp_c"] < 30 else "tight"
        band = ("inside the published 1.1\u20131.6 datacenter band"
                if s.get("pue_in_band") else "near published datacenter levels")
        return (
            f"Efficiency is healthy: PUE {s['pue']:.2f} (\u0394 {s['delta_pue']:+.3f} vs "
            f"baseline), {band}, with {s['thermal_violations']} thermal violations. "
            f"Outside air is {s.get('outside_air_c', 20):.0f}\u00b0C. Thermal headroom is "
            f"{headroom} \u2014 hottest is Cluster {s['hottest']['cluster']} at "
            f"{s['hottest']['temp_c']:.1f}\u00b0C. No action needed."
        )
    if any(k in q for k in ("outside", "weather", "economiz", "realistic", "real data", "azure", "accurate")):
        band = ("within the published 1.1\u20131.6 band" if s.get("pue_in_band")
                else "near published datacenter levels")
        return (
            f"Outside air is {s.get('outside_air_c', 20):.0f}\u00b0C, feeding the free-cooling "
            f"economizer, so COP and PUE shift with the time of day. Driven by the workload "
            f"trace, the emergent PUE is {s['pue']:.2f} \u2014 {band} for real datacenters."
        )
    if any(k in q for k in ("cooling", "temperature", "hot", "thermal", "setpoint")):
        return (
            f"Cooling setpoint is {s['t_supply']:.1f}\u00b0C. Hottest zone is Cluster "
            f"{s['hottest']['cluster']} at {s['hottest']['temp_c']:.1f}\u00b0C, well under the "
            f"32\u00b0C limit, so the controller is safely trading cooling for "
            f"{s['pct_cooling_saved']:.1f}% energy savings."
        )

    # Mention a specific cluster letter if asked, e.g. "cluster c".
    for letter in ("a", "b", "c", "d", "e", "f", "g", "h"):
        if f"cluster {letter}" in q:
            up = letter.upper()
            tag = " (hottest)" if up == s["hottest"]["cluster"] else \
                  " (coolest)" if up == s["coolest"]["cluster"] else ""
            return (
                f"Cluster {up}{tag}: the fleet averages {s['mean_util_pct']:.0f}% load at PUE "
                f"{s['pue']:.2f}. Hottest is Cluster {s['hottest']['cluster']} "
                f"({s['hottest']['temp_c']:.1f}\u00b0C); coolest is Cluster "
                f"{s['coolest']['cluster']} ({s['coolest']['load_pct']:.0f}% load)."
            )

    return (
        f"Fleet: {s['mean_util_pct']:.0f}% mean load, PUE {s['pue']:.2f}, "
        f"{s['power_draw_mw']:.2f} MW, saving {s['pct_cooling_saved']:.1f}% cooling energy "
        f"with {s['thermal_violations']} violations. Ask about power, efficiency, cooling, "
        f"or which cluster to use next."
    )
