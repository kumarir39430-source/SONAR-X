def get_confidence_level(confidence):
    if confidence is None:
        return "Unknown"

    if confidence >= 0.80:
        return "High"

    if confidence >= 0.50:
        return "Moderate"

    return "Low"


def get_evidence_strength(
    evidence_data=None,
    has_acoustic_shadow=False,
    has_target_shape=False,
    has_seabed_info=False,
    has_environment=False,
    has_location=False,
    evidence_strength=None,
    **kwargs
):
    """
    Evidence strength is based on actual supporting evidence,
    not the number of generated evidence strings.
    """

    # Preserve evidence strength calculated by evidence_engine.
    if evidence_strength in {
        "Strong",
        "Moderate",
        "Limited",
        "Insufficient",
    }:
        return evidence_strength

    # Strong:
    # target shape + acoustic shadow +
    # seabed/environment context
    if (
        has_target_shape
        and has_acoustic_shadow
        and (
            has_seabed_info
            or has_environment
        )
    ):
        return "Strong"

    # Moderate:
    # At least one actual physical/environmental clue.
    if (
        has_target_shape
        or has_acoustic_shadow
        or has_seabed_info
        or has_environment
    ):
        return "Moderate"

    # GPS/location is useful context but does not prove identity.
    if has_location:
        return "Limited"

    # AI prediction only.
    if evidence_data:
        return "Limited"

    return "Insufficient"


def assess_uncertainty(
    confidence=None,
    evidence_data=None,
    evidence_strength=None,
    has_acoustic_shadow=False,
    has_target_shape=False,
    has_seabed_info=False,
    has_environment=False,
    has_location=False,
    image_quality=None,
    expert_status="Pending",
    **kwargs
):
    """
    Assess uncertainty.

    Return field names are kept compatible with
    the existing assistant_engine.py.
    """

    confidence_level = get_confidence_level(
        confidence
    )

    final_evidence_strength = get_evidence_strength(
        evidence_data=evidence_data,
        has_acoustic_shadow=has_acoustic_shadow,
        has_target_shape=has_target_shape,
        has_seabed_info=has_seabed_info,
        has_environment=has_environment,
        has_location=has_location,
        evidence_strength=evidence_strength,
    )

    # ---------------------------------------------------------
    # Image quality
    # ---------------------------------------------------------

    poor_image = False

    if image_quality:
        quality = str(image_quality).lower()

        if quality in {
            "poor",
            "low",
            "noisy",
            "incomplete",
            "unusable",
        }:
            poor_image = True

    # ---------------------------------------------------------
    # Expert status
    # ---------------------------------------------------------

    expert_review_required = False

    if expert_status:
        status = str(expert_status).lower()

        if status in {
            "unknown",
            "unknown anomaly",
            "incorrect detection",
            "incorrect class",
            "requires further sonar inspection",
        }:
            expert_review_required = True

    # ---------------------------------------------------------
    # Uncertainty alert
    # ---------------------------------------------------------

    uncertainty_alert = False

    if confidence_level in {
        "Low",
        "Unknown",
    }:
        uncertainty_alert = True

    if final_evidence_strength in {
        "Limited",
        "Insufficient",
    }:
        uncertainty_alert = True

    if poor_image:
        uncertainty_alert = True

    if expert_review_required:
        uncertainty_alert = True

    # ---------------------------------------------------------
    # Recommendation
    # ---------------------------------------------------------

    if uncertainty_alert:
        recommendation = (
            "Insufficient evidence — expert verification required."
        )
    else:
        recommendation = (
            "Review the detection with the sonar evidence "
            "and continue survey assessment."
        )

    # IMPORTANT:
    # assistant_engine.py expects these exact keys.
    return {
        "confidence": confidence,
        "confidence_level": confidence_level,
        "evidence_strength": final_evidence_strength,
        "uncertainty_alert": uncertainty_alert,
        "recommendation": recommendation,
    }