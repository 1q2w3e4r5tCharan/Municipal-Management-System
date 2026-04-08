# department email mapping used by backend and UI
# Keys are department ids as used in tickets (department column) or normalized labels.
DEPARTMENT_EMAILS = {
    'public_works': 'publicworks@city.gov',
    'citizen_services': 'citizen.services@city.gov',
    'traffic_management': 'traffic@city.gov',
    'parks_or_community': 'parks@city.gov',
    'utilities': 'utilities@city.gov',
    'code_enforcement': 'code.enforcement@city.gov',
}

# Andhra Pradesh municipal departments and examples
AP_MUNICIPAL_DEPARTMENTS = {
    'citizen_services': 'citizen.services@ap.gov.in',
    'engineering': 'engineering@ap.gov.in',
    'water_supply': 'watersupply@ap.gov.in',
    'solid_waste': 'sanitation@ap.gov.in',
    'street_lights': 'streetlights@ap.gov.in',
    'health': 'health@ap.gov.in',
    'urban_development': 'urban.dev@ap.gov.in',
}

# Sample municipality codes -> names (expandable)
MUNICIPALITIES = {
    # Major Andhra Pradesh municipal corporations and common codes
    'VSP': 'Visakhapatnam',
    'VJA': 'Vijayawada',
    'GTR': 'Guntur',
    'TPT': 'Tirupati',
    'KAK': 'Kakinada',
    'NLR': 'Nellore',
    'RJY': 'Rajahmundry',
    'KRL': 'Kurnool',
    'ATP': 'Anantapur',
    'ELU': 'Eluru',
    'ONG': 'Ongole',
    'KDP': 'Kadapa',
    'SKM': 'Srikakulam',
    'VZM': 'Vizianagaram',
    'AMM': 'Amalapuram'
}


def get_email_for(department_id=None, department_label=None):
    """Return an email address for a department id or label."""
    # prefer AP municipal emails when department exists there
    if department_id and department_id in AP_MUNICIPAL_DEPARTMENTS:
        return AP_MUNICIPAL_DEPARTMENTS[department_id]
    if department_id and department_id in DEPARTMENT_EMAILS:
        return DEPARTMENT_EMAILS[department_id]
    if department_label:
        # try to normalize label to a key
        key = ''.join([c for c in department_label.lower() if c.isalnum() or c.isspace()]).strip()
        # heuristics: look for known tokens
        for token, email in {**AP_MUNICIPAL_DEPARTMENTS, **DEPARTMENT_EMAILS}.items():
            if token.replace('_', ' ') in key or token in key:
                return email
    # default contact
    return 'contact@city.gov'


def list_municipalities():
    """Return the municipality code->name mapping."""
    return MUNICIPALITIES
