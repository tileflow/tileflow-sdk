package dev.tileflow.sdk

import android.util.Log

/** Delivers structured map diagnostics to an application-owned destination on the UI thread. */
public class TileflowMapDiagnostics(
    public val minimumLevel: Level = Level.WARNING,
    private val sink: (Entry) -> Unit,
) {
    public enum class Level {
        DEBUG,
        INFO,
        WARNING,
        ERROR,
    }

    public enum class Event(public val level: Level) {
        LOADING(Level.DEBUG),
        CONTENT_READY(Level.INFO),
        WARNING(Level.WARNING),
        FAILURE(Level.ERROR),
    }

    /** Only typed event and resource metadata reach the sink. */
    public data class Entry(
        val event: Event,
        val code: TileflowErrorCode?,
        val resource: TileflowResourceKind?,
        val feature: String?,
        val status: Int?,
        val occurrences: Int,
    )

    private fun record(event: TileflowMapEvent) {
        when (event) {
            TileflowMapEvent.Loading -> write(Event.LOADING)
            TileflowMapEvent.ContentReady -> write(Event.CONTENT_READY)
            is TileflowMapEvent.Warning ->
                write(Event.WARNING, event.code, event.context, event.occurrences)
            is TileflowMapEvent.Failed -> write(Event.FAILURE, event.code, event.context)
            else -> Unit
        }
    }

    internal companion object {
        private val features =
            setOf(
                "scene3d",
                "models3d",
                "trees3d",
                "streetLights",
                "terrain3d",
                "globe",
                "sky",
                "pitchAbove60",
                "deviceContours",
                "pathGround",
                "embeddedImages",
                "nauticalLightRhythm",
                "symbolOverlap",
                "reliefResampling",
                "text",
            )

        fun report(event: TileflowMapEvent, diagnostics: TileflowMapDiagnostics?) {
            if (diagnostics != null) {
                diagnostics.record(event)
            } else if (
                event is TileflowMapEvent.Warning && event.context.reason == "featureUnavailable"
            ) {
                val feature = event.context.feature?.takeIf(features::contains) ?: "unrecognized"
                Log.w("Tileflow", "Native map feature unavailable ($feature).")
            }
        }
    }

    private fun write(
        event: Event,
        code: TileflowErrorCode? = null,
        context: TileflowErrorContext? = null,
        occurrences: Int = 1,
    ) {
        if (event.level >= minimumLevel)
            sink(
                Entry(
                    event,
                    code,
                    context?.resource,
                    context?.feature?.takeIf(features::contains),
                    context?.status,
                    occurrences,
                )
            )
    }
}
