"""EcoTwin backend package.

Ensures the repo root is importable so ``import model`` (the physics module kept
at the repo root) resolves regardless of the current working directory.
"""

from __future__ import annotations

import os
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
