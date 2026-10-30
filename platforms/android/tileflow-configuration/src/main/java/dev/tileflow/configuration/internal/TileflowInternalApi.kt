package dev.tileflow.configuration.internal

/**
 * Marks declarations that Tileflow modules share with each other. They are not part of the
 * supported API and may change in any release.
 */
@RequiresOptIn(
    message =
        "This declaration is shared between Tileflow modules and is not part of the supported API.",
    level = RequiresOptIn.Level.ERROR,
)
@Retention(AnnotationRetention.BINARY)
@Target(
    AnnotationTarget.CLASS,
    AnnotationTarget.FUNCTION,
    AnnotationTarget.PROPERTY,
    AnnotationTarget.CONSTRUCTOR,
    AnnotationTarget.TYPEALIAS,
)
public annotation class TileflowInternalApi
