"""Single source of truth for role and permission codes.

The initial migration seeds exactly these rows; a unit test asserts the two agree.
"""

PASSENGER = "passenger"
ADMIN = "admin"
SUPER_ADMIN = "super_admin"

ROLES: dict[str, tuple[str, str]] = {
    PASSENGER: ("Passenger", "Plans journeys and manages their own bookings."),
    ADMIN: ("Administrator", "Monitors the platform; read access to operational data."),
    SUPER_ADMIN: (
        "Super Administrator",
        "Grants roles and changes pricing, provider and critical system settings.",
    ),
}

PERMISSIONS: dict[str, str] = {
    "profile.read_own": "Read own profile",
    "profile.update_own": "Update own profile",
    "admin.access": "Open the administration area",
    "user.read_all": "List and view all users",
    "audit.read": "Read the admin audit log",
    "role.grant": "Grant or revoke roles",
    "service_charge.manage": "Change service-charge configuration",
    "provider.manage": "Change provider configuration",
    "system_settings.manage": "Change critical system settings",
    # added in migration 0003
    "moderation.manage": "Moderate community posts and reports",
    "booking.read_all": "View all bookings, payments and refunds",
    "user.manage": "Enable or disable user accounts",
    "analytics.read": "View analytics and monitoring",
}

_PASSENGER_PERMS = {"profile.read_own", "profile.update_own"}
_ADMIN_PERMS = _PASSENGER_PERMS | {
    "admin.access", "user.read_all", "audit.read",
    "moderation.manage", "booking.read_all", "user.manage", "analytics.read",
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    PASSENGER: _PASSENGER_PERMS,
    ADMIN: _ADMIN_PERMS,
    SUPER_ADMIN: set(PERMISSIONS),
}
