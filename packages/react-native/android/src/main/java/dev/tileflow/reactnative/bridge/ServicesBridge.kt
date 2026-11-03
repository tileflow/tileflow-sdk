package dev.tileflow.reactnative.bridge

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.elevation.TileflowElevatedPosition
import dev.tileflow.elevation.TileflowElevation
import dev.tileflow.elevation.TileflowElevationBatch
import dev.tileflow.elevation.TileflowElevationDataset
import dev.tileflow.elevation.TileflowElevationException
import dev.tileflow.elevation.TileflowElevationLine
import dev.tileflow.elevation.TileflowElevationPointsResponse
import dev.tileflow.elevation.TileflowElevationProfile
import dev.tileflow.elevation.TileflowElevationProfileRequest
import dev.tileflow.elevation.TileflowElevationUnit
import dev.tileflow.geoip.TileflowGeoIP
import dev.tileflow.geoip.TileflowGeoIPException
import dev.tileflow.geoip.TileflowGeoIPResponse
import dev.tileflow.routing.TileflowIsochroneRequest
import dev.tileflow.routing.TileflowIsochroneResponse
import dev.tileflow.routing.TileflowMatchRequest
import dev.tileflow.routing.TileflowMatchResponse
import dev.tileflow.routing.TileflowMatrixRequest
import dev.tileflow.routing.TileflowMatrixResponse
import dev.tileflow.routing.TileflowNearestRequest
import dev.tileflow.routing.TileflowNearestResponse
import dev.tileflow.routing.TileflowRoad
import dev.tileflow.routing.TileflowRouteRequest
import dev.tileflow.routing.TileflowRouteResponse
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.routing.TileflowRoutingException
import dev.tileflow.routing.TileflowRoutingLanguage
import dev.tileflow.routing.TileflowRoutingMode
import dev.tileflow.routing.TileflowRoutingTraffic
import dev.tileflow.routing.TileflowRoutingNetwork
import dev.tileflow.routing.TileflowVehicle
import dev.tileflow.search.TileflowAutocompleteRequest
import dev.tileflow.search.TileflowAutocompleteResponse
import dev.tileflow.search.TileflowGeocodeRequest
import dev.tileflow.search.TileflowGeocodeResponse
import dev.tileflow.search.TileflowNearbyRequest
import dev.tileflow.search.TileflowNearbyResponse
import dev.tileflow.search.TileflowPlace
import dev.tileflow.search.TileflowResolveSuggestionRequest
import dev.tileflow.search.TileflowResolveSuggestionResponse
import dev.tileflow.search.TileflowReverseGeocodeRequest
import dev.tileflow.search.TileflowSearch
import dev.tileflow.search.TileflowSearchAttribution
import dev.tileflow.search.TileflowSearchCategoriesResponse
import dev.tileflow.search.TileflowSearchCategory
import dev.tileflow.search.TileflowSearchException
import dev.tileflow.search.TileflowSearchSource
import kotlin.coroutines.cancellation.CancellationException

/** The native service clients a bridge call uses. Tests give clients a stub server. */
class ServiceClients(
    val search: TileflowSearch,
    val routing: TileflowRouting,
    val elevation: TileflowElevation,
    val geoIP: TileflowGeoIP,
)

/** Runs one operation of a native service client from JavaScript arguments. */
object ServicesBridge {
    suspend fun call(
        service: String,
        operation: String,
        request: Any?,
        clients: ServiceClients,
    ): Map<String, Any?> =
        try {
            run(service, operation, BridgeObject(request), clients)
        } catch (error: CancellationException) {
            throw error
        } catch (error: BridgeArgumentException) {
            throw BridgeFailure(
                "invalidRequest",
                error.message ?: "Invalid request",
                mapOf("kind" to "invalidRequest"),
            )
        } catch (error: Exception) {
            throw failure(error)
        }

    /** Which services, and the map, have a credential in the configuration. Never the credential. */
    fun configuredServices(configuration: () -> TileflowConfiguration): Map<String, Boolean> {
        val value = runCatching(configuration).getOrNull()
        val result = linkedMapOf("map" to (value?.mapCredential != null))
        for (service in TileflowService.entries) {
            result[serviceName(service)] = value?.credential(service) != null
        }
        return result
    }

    private fun serviceName(service: TileflowService): String =
        service.name.lowercase()

    private suspend fun run(
        service: String,
        operation: String,
        request: BridgeObject,
        clients: ServiceClients,
    ): Map<String, Any?> =
        when ("$service.$operation") {
            "search.geocode" -> geocode(clients.search.geocode(geocode(request)))
            "search.reverseGeocode" -> geocode(clients.search.reverseGeocode(reverseGeocode(request)))
            "search.autocomplete" -> autocomplete(clients.search.autocomplete(autocomplete(request)))
            "search.resolveSuggestion" ->
                resolve(
                    clients.search.resolveSuggestion(
                        TileflowResolveSuggestionRequest(request.string("token"), request.choices("include"))
                    )
                )
            "search.searchNearby" -> nearby(clients.search.searchNearby(nearby(request)))
            "search.listCategories" -> categories(clients.search.listCategories())
            "routing.route" -> route(clients.routing.route(route(request)))
            "routing.isochrone" -> isochrone(clients.routing.isochrone(isochrone(request)))
            "routing.matrix" -> matrix(clients.routing.matrix(matrix(request)))
            "routing.match" -> match(clients.routing.match(match(request)))
            "routing.nearest" ->
                nearest(
                    clients.routing.nearest(TileflowNearestRequest(request.position("location"), mode(request)))
                )
            "elevation.points" ->
                points(clients.elevation.points(request.positions("positions"), unit(request)))
            "elevation.elevation" ->
                mapOf("elevation" to clients.elevation.elevation(request.position("position"), unit(request)))
            "elevation.batch" -> batch(clients.elevation.batch(request.positions("positions"), unit(request)))
            "elevation.profile" -> profile(clients.elevation.profile(profile(request)))
            "geoip.locate" -> geoIP(clients.geoIP.locate())
            else -> throw BridgeArgumentException("operation", "a Tileflow service operation")
        }

    // MARK: Requests

    fun geocode(request: BridgeObject) =
        TileflowGeocodeRequest(
            query = request.string("query"),
            language = request.optionalString("language"),
            limit = request.optionalInt("limit"),
            bounds = request.optionalBoundingBox("bounds"),
            proximity = request.optionalPosition("proximity"),
            include = request.choices("include"),
        )

    fun reverseGeocode(request: BridgeObject) =
        TileflowReverseGeocodeRequest(
            position = request.position("position"),
            kinds = request.choices("kinds"),
            language = request.optionalString("language"),
            limit = request.optionalInt("limit") ?: 1,
            include = request.choices("include"),
        )

    fun autocomplete(request: BridgeObject) =
        TileflowAutocompleteRequest(
            query = request.string("query"),
            language = request.optionalString("language"),
            limit = request.optionalInt("limit") ?: 5,
            bounds = request.optionalBoundingBox("bounds"),
            proximity = request.optionalPosition("proximity"),
            includesPlaces = request.bool("includesPlaces", false),
        )

    fun nearby(request: BridgeObject) =
        TileflowNearbyRequest(
            position = request.position("position"),
            radiusMeters = request.optionalInt("radiusMeters"),
            bounds = request.optionalBoundingBox("bounds"),
            includeCategories = request.strings("includeCategories"),
            excludeCategories = request.strings("excludeCategories"),
            countries = request.strings("countries"),
            language = request.optionalString("language"),
            include = request.choices("include"),
            limit = request.optionalInt("limit") ?: 20,
            cursor = request.optionalString("cursor"),
        )

    private fun mode(request: BridgeObject): TileflowRoutingMode =
        request.choice<TileflowRoutingMode>("mode") ?: throw BridgeArgumentException("${request.path}.mode", "a routing mode")

    private fun vehicle(request: BridgeObject): TileflowVehicle? {
        val vehicle = request.optionalObject("vehicle") ?: return null
        return TileflowVehicle(
            heightMeters = vehicle.optionalDouble("heightMeters"),
            widthMeters = vehicle.optionalDouble("widthMeters"),
            lengthMeters = vehicle.optionalDouble("lengthMeters"),
            weightTonnes = vehicle.optionalDouble("weightTonnes"),
            axleLoadTonnes = vehicle.optionalDouble("axleLoadTonnes"),
            axleCount = vehicle.optionalInt("axleCount"),
            hazardousMaterials = vehicle.optionalBool("hazardousMaterials"),
        )
    }

    fun route(request: BridgeObject) =
        TileflowRouteRequest(
            locations = request.positions("locations"),
            mode = mode(request),
            vehicle = vehicle(request),
            avoid = request.choices("avoid"),
            traffic = request.choice<TileflowRoutingTraffic>("traffic"),
            alternatives = request.optionalInt("alternatives") ?: 0,
            language = request.choice<TileflowRoutingLanguage>("language"),
        )

    fun isochrone(request: BridgeObject) =
        TileflowIsochroneRequest(
            location = request.position("location"),
            mode = mode(request),
            minutes = request.ints("minutes"),
            vehicle = vehicle(request),
            avoid = request.choices("avoid"),
            traffic = request.choice<TileflowRoutingTraffic>("traffic"),
        )

    fun matrix(request: BridgeObject) =
        TileflowMatrixRequest(
            sources = request.positions("sources"),
            targets = request.positions("targets"),
            mode = mode(request),
            vehicle = vehicle(request),
            avoid = request.choices("avoid"),
            traffic = request.choice<TileflowRoutingTraffic>("traffic"),
        )

    fun match(request: BridgeObject) =
        TileflowMatchRequest(
            trace = request.positions("trace"),
            mode = mode(request),
            timestamps = if (request.has("timestamps")) request.ints("timestamps").map(Int::toLong) else null,
            accuracy = request.optionalDouble("accuracy"),
            vehicle = vehicle(request),
        )

    private fun unit(request: BridgeObject): TileflowElevationUnit =
        request.choice<TileflowElevationUnit>("unit") ?: TileflowElevationUnit.METERS

    fun profile(request: BridgeObject): TileflowElevationProfileRequest {
        val line = request.obj("line")
        val value =
            when (line.string("type")) {
                "LineString" -> TileflowElevationLine.LineString(line.positions("coordinates"))
                "MultiLineString" ->
                    TileflowElevationLine.MultiLineString(
                        line.array("coordinates").mapIndexed { index, part ->
                            val path = "${line.path}.coordinates[$index]"
                            BridgeObject.positions(
                                part as? List<Any?> ?: throw BridgeArgumentException(path, "a list of positions"),
                                path,
                            )
                        }
                    )
                "Polyline" ->
                    TileflowElevationLine.Polyline(line.string("encoded"), line.optionalInt("precision") ?: 5)
                else ->
                    throw BridgeArgumentException(
                        "${line.path}.type",
                        "LineString, MultiLineString or Polyline",
                    )
            }
        return TileflowElevationProfileRequest(
            line = value,
            interval = request.optionalDouble("interval"),
            maxSamples = request.optionalInt("maxSamples"),
            climbThreshold = request.optionalDouble("climbThreshold"),
            unit = unit(request),
        )
    }

    // MARK: Answers

    private fun source(source: TileflowSearchSource) =
        bridgeObject {
            put("id", source.id)
            put("revision", source.revision)
        }

    private fun attribution(items: List<TileflowSearchAttribution>) =
        items.map {
            bridgeObject {
                put("text", it.text)
                put("url", it.url?.toString())
            }
        }

    private fun category(category: TileflowSearchCategory) =
        bridgeObject {
            put("id", category.id)
            put("name", category.name)
            put("localizedName", category.localizedName)
            put("primary", category.primary)
        }

    fun place(place: TileflowPlace) =
        bridgeObject {
            put("kind", place.kind.value)
            put("label", place.label)
            put("position", place.position.bridge())
            put(
                "address",
                bridgeObject {
                    val address = place.address
                    put("name", address.name)
                    put("houseNumber", address.houseNumber)
                    put("street", address.street)
                    put("locality", address.locality)
                    put("district", address.district)
                    put("city", address.city)
                    put("county", address.county)
                    put("region", address.region)
                    put("postalCode", address.postalCode)
                    put("country", address.country)
                    put("countryCode", address.countryCode)
                },
            )
            put("bounds", place.bounds?.bridge())
            put("sourceRef", place.sourceRef)
            put("name", place.name)
            put("categories", place.categories.map(::category))
            put("foodTypes", place.foodTypes.map(::category))
            put("businessChains", place.businessChains.map { mapOf("id" to it.id, "name" to it.name) })
            put("distanceMeters", place.distanceMeters)
            put(
                "contacts",
                place.contacts?.let { contacts ->
                    fun entries(list: List<dev.tileflow.search.TileflowContact>) =
                        list.map {
                            bridgeObject {
                                put("value", it.value)
                                put("label", it.label)
                            }
                        }
                    mapOf(
                        "phones" to entries(contacts.phones),
                        "websites" to entries(contacts.websites),
                        "emails" to entries(contacts.emails),
                    )
                },
            )
            put(
                "openingHours",
                place.openingHours.map {
                    bridgeObject {
                        put("display", it.display)
                        put("openNow", it.openNow)
                    }
                },
            )
            put(
                "timeZone",
                place.timeZone?.let {
                    bridgeObject {
                        put("name", it.name)
                        put("utcOffsetSeconds", it.utcOffsetSeconds)
                    }
                },
            )
            put("accessPoints", place.accessPoints.bridgePositions())
            put("token", place.token)
        }

    private fun geocode(answer: TileflowGeocodeResponse) =
        bridgeObject {
            put("queryId", answer.queryId)
            put("results", answer.results.map(::place))
            put("source", source(answer.source))
            put("attribution", attribution(answer.attribution))
            put("units", answer.units)
        }

    private fun autocomplete(answer: TileflowAutocompleteResponse) =
        bridgeObject {
            put(
                "suggestions",
                answer.suggestions.map {
                    bridgeObject {
                        put("kind", it.kind.value)
                        put("label", it.label)
                        put("addressLabel", it.addressLabel)
                        put("place", it.place?.let(::place))
                        put("token", it.token)
                    }
                },
            )
            put("source", source(answer.source))
            put("attribution", attribution(answer.attribution))
            put("units", answer.units)
        }

    private fun resolve(answer: TileflowResolveSuggestionResponse) =
        bridgeObject {
            put("result", place(answer.result))
            put("source", source(answer.source))
            put("attribution", attribution(answer.attribution))
            put("units", answer.units)
        }

    private fun nearby(answer: TileflowNearbyResponse) =
        bridgeObject {
            put("results", answer.results.map(::place))
            put("nextCursor", answer.nextCursor)
            put("source", source(answer.source))
            put("attribution", attribution(answer.attribution))
            put("units", answer.units)
        }

    private fun categories(answer: TileflowSearchCategoriesResponse) =
        bridgeObject {
            put("categories", answer.categories.map(::category))
            put("source", source(answer.source))
            put("attribution", attribution(answer.attribution))
        }

    private fun BridgeMap.routing(
        network: TileflowRoutingNetwork,
        attribution: String,
        traffic: String,
        units: Int,
    ) {
        put("network", mapOf("releaseId" to network.releaseId))
        put("attribution", attribution)
        put("traffic", traffic)
        put("units", units)
    }

    private fun route(answer: TileflowRouteResponse) =
        bridgeObject {
            put(
                "routes",
                answer.routes.map { route ->
                    bridgeObject {
                        put("distance", route.distance)
                        put("duration", route.duration)
                        put("hasTolls", route.hasTolls)
                        put("hasHighways", route.hasHighways)
                        put("hasFerries", route.hasFerries)
                        put("geometry", route.geometry.bridgePositions())
                        put(
                            "legs",
                            route.legs.map { leg ->
                                bridgeObject {
                                    put("distance", leg.distance)
                                    put("duration", leg.duration)
                                    put(
                                        "steps",
                                        leg.steps.map { step ->
                                            bridgeObject {
                                                put("maneuver", step.maneuver.value)
                                                put("instruction", step.instruction)
                                                put("names", step.names)
                                                put("exit", step.exit)
                                                put("toward", step.toward)
                                                put("roundaboutExit", step.roundaboutExit)
                                                put("distance", step.distance)
                                                put("duration", step.duration)
                                                put("location", step.location.bridge())
                                            }
                                        },
                                    )
                                }
                            },
                        )
                    }
                },
            )
            routing(answer.network, answer.attribution, answer.traffic.value, answer.units)
        }

    private fun isochrone(answer: TileflowIsochroneResponse) =
        bridgeObject {
            put(
                "isochrones",
                answer.isochrones.map {
                    mapOf(
                        "minutes" to it.minutes,
                        "polygons" to it.polygons.map { polygon -> polygon.map { ring -> ring.bridgePositions() } },
                    )
                },
            )
            routing(answer.network, answer.attribution, answer.traffic.value, answer.units)
        }

    private fun matrix(answer: TileflowMatrixResponse) =
        bridgeObject {
            put("durations", answer.durations)
            put("distances", answer.distances)
            routing(answer.network, answer.attribution, answer.traffic.value, answer.units)
        }

    private fun road(road: TileflowRoad) =
        bridgeObject {
            put("names", road.names)
            put("wayId", road.wayId)
            put("roadClass", road.roadClass.value)
            put("surface", road.surface?.value)
            put("lanes", road.lanes)
            put("speedLimit", road.speedLimit?.let { mapOf("kmh" to it.kmh, "source" to it.source) })
            put("toll", road.toll)
            put("bridge", road.bridge)
            put("tunnel", road.tunnel)
            put("roundabout", road.roundabout)
            put("length", road.length)
        }

    private fun match(answer: TileflowMatchResponse) =
        bridgeObject {
            put("distance", answer.distance)
            put("duration", answer.duration)
            put("geometry", answer.geometry.bridgePositions())
            put(
                "points",
                answer.points.map { point ->
                    point?.let { mapOf("location" to it.location.bridge(), "distance" to it.distance) }
                },
            )
            put("roads", answer.roads.map(::road))
            routing(answer.network, answer.attribution, answer.traffic.value, answer.units)
        }

    private fun nearest(answer: TileflowNearestResponse) =
        bridgeObject {
            put("location", answer.location.bridge())
            put("distance", answer.distance)
            put("road", road(answer.road))
            routing(answer.network, answer.attribution, answer.traffic.value, answer.units)
        }

    private fun elevated(positions: List<TileflowElevatedPosition>) =
        positions.map {
            bridgeObject {
                put("elevation", it.elevation)
                put("position", it.position.bridge())
            }
        }

    private fun dataset(dataset: TileflowElevationDataset) =
        mapOf("releaseId" to dataset.releaseId, "zoom" to dataset.zoom)

    private fun unitName(unit: TileflowElevationUnit) = BridgeObject.caseName(unit.name)

    private fun points(answer: TileflowElevationPointsResponse) =
        bridgeObject {
            put("positions", elevated(answer.positions))
            put("unit", unitName(answer.unit))
            put("dataset", dataset(answer.dataset))
            put("attribution", answer.attribution)
            put("units", answer.units)
        }

    private fun batch(answer: TileflowElevationBatch) =
        bridgeObject {
            put("positions", elevated(answer.positions))
            put("unit", unitName(answer.unit))
            put("attribution", answer.attribution)
            put("units", answer.units)
        }

    private fun profile(answer: TileflowElevationProfile) =
        bridgeObject {
            put("unit", unitName(answer.unit))
            put("dataset", dataset(answer.dataset))
            put("attribution", answer.attribution)
            put("units", answer.units)
            put("interval", answer.interval)
            put(
                "samples",
                answer.samples.map {
                    bridgeObject {
                        put("position", it.position.bridge())
                        put("elevation", it.elevation)
                        put("distance", it.distance)
                    }
                },
            )
            put("lines", answer.lines.map { listOf(it.first, it.last) })
            val summary = answer.summary
            put(
                "summary",
                bridgeObject {
                    put("distance", summary.distance)
                    put("ascent", summary.ascent)
                    put("descent", summary.descent)
                    put("minElevation", summary.minElevation)
                    put("maxElevation", summary.maxElevation)
                    put("startElevation", summary.startElevation)
                    put("endElevation", summary.endElevation)
                    put("maxGrade", summary.maxGrade)
                    put("minGrade", summary.minGrade)
                },
            )
        }

    private fun geoIP(answer: TileflowGeoIPResponse) =
        bridgeObject {
            put(
                "location",
                answer.location?.let { location ->
                    bridgeObject {
                        put("city", location.city)
                        put("continentCode", location.continentCode?.value)
                        put("countryCode", location.countryCode)
                        put("isEuCountry", location.isEuCountry)
                        put("position", location.position?.bridge())
                        put("postalCode", location.postalCode)
                        put("region", location.region)
                        put("regionCode", location.regionCode)
                        put("timezone", location.timezone)
                    }
                },
            )
            put("units", answer.units)
        }

    // MARK: Errors

    fun failure(error: Throwable): BridgeFailure {
        if (error !is TileflowServiceException) {
            return BridgeFailure("network", "Tileflow service request failed", mapOf("kind" to "network"))
        }
        val code =
            when (error) {
                is TileflowSearchException -> error.code?.wireName
                is TileflowRoutingException -> error.code?.wireName
                is TileflowElevationException -> error.code?.wireName
                is TileflowGeoIPException -> error.code?.wireName
                else -> null
            }
        val kind = kindName(error.kind)
        val info =
            bridgeObject {
                put("kind", kind)
                put("code", code)
                put("status", error.status)
                put("requestId", error.requestId)
                put("retryAfter", error.retryAfterSeconds?.let { it * 1000.0 })
            }
        return BridgeFailure(code ?: kind, error.message ?: "Tileflow service request failed", info)
    }

    private fun kindName(kind: TileflowServiceErrorKind) = BridgeObject.caseName(kind.name)
}
