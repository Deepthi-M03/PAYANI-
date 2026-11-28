"""Imports every model so `Base.metadata` is complete for Alembic and tests."""

from payani.core.db import Base
from payani.modules.admin.models import AdminAuditLog
from payani.modules.book.models import (
    Booking,
    BookingEvent,
    BookingPassenger,
    BookingPolicy,
    CancellationRequest,
    Group,
    GroupInvitation,
    GroupMember,
    IdempotencyKey,
    JourneySearch,
    Payment,
    ProviderSyncRun,
    Refund,
    RefundTracking,
    Station,
    TrainRow,
    TrainStop,
)
from payani.modules.connect.models import (
    AppSetting,
    CommunityMember,
    CommunityPost,
    CommunityReport,
    ContactShareRequest,
    ServiceChargeConfig,
    TravelCommunity,
    UserBlock,
)
from payani.modules.identity.models import (
    ConsentRecord,
    PassengerProfile,
    Permission,
    RefreshToken,
    Role,
    RolePermission,
    User,
    UserRole,
)
from payani.modules.pulse.models import (
    DeviceRegistration,
    InAppNotification,
    Job,
    JourneyReminder,
    NotificationDeliveryLog,
    NotificationOutbox,
    NotificationPreference,
    NotificationSchedule,
)
from payani.modules.timetable.models import TimetableImport

__all__ = [name for name in dir() if name[0].isupper()]
