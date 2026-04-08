from typing import Tuple

# Map predicted labels to municipal departments or volunteer groups
ROUTING_MAP = {
    "pothole": ("engineering", "Engineering / Road Maintenance"),
    "street_light": ("street_lights", "Street Lighting"),
    "graffiti": ("citizen_services", "Citizen Services / Vandalism"),
    "flooding": ("water_supply", "Drainage / Waterlogging"),
    "trash": ("solid_waste", "Solid Waste / Sanitation"),
    "sidewalk_damage": ("engineering", "Engineering / Sidewalks"),
    "other": ("citizen_services", "Citizen Services / Review"),
    "fallen_tree": ("parks_or_community", "Parks / Tree Management"),
}


def route(label: str) -> Tuple[str, str]:
    """Return (queue_id, human_readable_department)

    If label unknown, route to `citizen_services` by default.
    """
    return ROUTING_MAP.get(label, ROUTING_MAP["other"]) 
