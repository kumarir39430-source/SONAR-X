def build_detection_evidence(
    detection,
    acoustic_shadow=None,
    target_shape=None,
    seabed_info=None,
    location=None,
    environment=None,
    **kwargs
):
    """
    Build structured evidence for one sonar detection.

    This function is compatible with the existing
    assistant_engine.py interface.
    """

    evidence = []

    # ---------------------------------------------------------
    # AI detector information
    # ---------------------------------------------------------

    confidence = detection.get("confidence")

    if confidence is not None:
        evidence.append(
            f"AI detector confidence: {confidence}"
        )

    class_name = detection.get("class_name")

    if class_name:
        evidence.append(
            f"Predicted class: {class_name}"
        )

    bbox = detection.get("bbox")

    if bbox:
        evidence.append(
            f"Detected target bounding box: {bbox}"
        )

    # ---------------------------------------------------------
    # Supporting evidence
    # ---------------------------------------------------------

    if acoustic_shadow:
        evidence.append(
            f"Acoustic-shadow evidence: {acoustic_shadow}"
        )

    if target_shape:
        evidence.append(
            f"Target-shape evidence: {target_shape}"
        )

    if seabed_info:
        evidence.append(
            f"Seabed context: {seabed_info}"
        )

    if environment:
        evidence.append(
            f"Environmental context: {environment}"
        )

    if location:
        evidence.append(
            f"Geospatial location: {location}"
        )

    # ---------------------------------------------------------
    # Evidence strength
    # ---------------------------------------------------------

    physical_evidence = 0

    if target_shape:
        physical_evidence += 1

    if acoustic_shadow:
        physical_evidence += 1

    if seabed_info:
        physical_evidence += 1

    if environment:
        physical_evidence += 1

    if (
        target_shape
        and acoustic_shadow
        and (seabed_info or environment)
    ):
        evidence_strength = "Strong"

    elif physical_evidence >= 1:
        evidence_strength = "Moderate"

    elif location:
        evidence_strength = "Limited"

    elif (
        confidence is not None
        or class_name
        or bbox
    ):
        evidence_strength = "Limited"

    else:
        evidence_strength = "Insufficient"

    # ---------------------------------------------------------
    # Return complete structure expected by assistant_engine
    # ---------------------------------------------------------

    return {
        "evidence": evidence,
        "evidence_strength": evidence_strength,
        "has_location": bool(location),
        "has_acoustic_shadow": bool(acoustic_shadow),
        "has_target_shape": bool(target_shape),
        "has_seabed_info": bool(seabed_info),
        "has_environment": bool(environment)
    }


def build_evidence(detection, context=None):
    """
    Backward-compatible wrapper.
    """

    context = context or {}

    return build_detection_evidence(
        detection=detection,
        acoustic_shadow=context.get("acoustic_shadow"),
        target_shape=context.get("target_shape"),
        seabed_info=context.get("seabed"),
        location=context.get("location"),
        environment=context.get("environment")
    )


def calculate_evidence_strength(
    detection,
    acoustic_shadow=None,
    target_shape=None,
    seabed_info=None,
    location=None,
    environment=None,
    **kwargs
):
    """
    Return only the evidence-strength value.
    """

    result = build_detection_evidence(
        detection=detection,
        acoustic_shadow=acoustic_shadow,
        target_shape=target_shape,
        seabed_info=seabed_info,
        location=location,
        environment=environment
    )

    return result["evidence_strength"]