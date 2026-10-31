from django.conf import settings
from django.db import models


class TripSearch(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trip_searches")
    origin = models.JSONField()
    destination = models.JSONField()
    departure = models.DateTimeField()
    load_weight_lb = models.PositiveIntegerField()
    summary = models.JSONField()
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]
