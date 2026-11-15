"""Source registry. Order = display order of source health (TS SOURCE_ORDER in aggregate.ts)."""

from app.sources.base import Source
from app.sources.bdns import BdnsSource
from app.sources.bocm import BocmSource
from app.sources.boe import BoeSource
from app.sources.dog import DogSource
from app.sources.eu import EuSource
from app.sources.fb import FbSource
from app.sources.rsc import RscSource

# The product's source set, in display order. Ids not yet ported are listed so their health sorts right.
SOURCE_ORDER = ("bdns", "boe", "eu", "bocm", "dog", "fb", "rsc")

SOURCES: dict[str, Source] = {
    s.id: s for s in (BdnsSource(), BoeSource(), EuSource(), BocmSource(), DogSource(), FbSource(), RscSource())
}
