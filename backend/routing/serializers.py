from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from .models import TripSearch

MAX_LOAD_LB = 80_000
MAX_DEPARTURE_DAYS = 7


class PlaceSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=255)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=3, max_length=100)


class TripRequestSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.DateTimeField()
    load_weight_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)

    def validate_departure(self, value):
        now = timezone.now()
        if value < now - timedelta(hours=1):
            raise serializers.ValidationError("Departure cannot be in the past.")
        if value > now + timedelta(days=MAX_DEPARTURE_DAYS):
            raise serializers.ValidationError(f"Departure must be within the next {MAX_DEPARTURE_DAYS} days.")
        return value

    def validate(self, attrs):
        origin, destination = attrs["origin"], attrs["destination"]
        if (origin["lat"], origin["lng"]) == (destination["lat"], destination["lng"]):
            raise serializers.ValidationError("Origin and destination must be different.")
        return attrs


class CredentialsSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        return value.lower()


class RegisterSerializer(CredentialsSerializer):
    def validate_email(self, value):
        value = super().validate_email(value)
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        try:
            validate_password(attrs["password"])
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email")


class TripSearchSerializer(serializers.ModelSerializer):
    class Meta:
        model = TripSearch
        fields = ("id", "origin", "destination", "departure", "load_weight_lb", "summary", "created_at")


class TripSearchDetailSerializer(TripSearchSerializer):
    class Meta(TripSearchSerializer.Meta):
        fields = (*TripSearchSerializer.Meta.fields, "result")
