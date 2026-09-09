#include <proj.h>
#include <tiffio.h>
#include <sqlite3.h>
#include <map>
#include <sstream>
#include <limits>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using json = nlohmann::json;
using Object = std::unique_ptr<PJ, decltype(&proj_destroy)>;
using Objects = std::unique_ptr<PJ_OBJ_LIST, decltype(&proj_list_destroy)>;

struct Failure : std::runtime_error {
    std::string code;
    json details = json::object();
    int index = -1;
    int nativeCode = 0;
    explicit Failure(std::string value, int error = 0) : std::runtime_error(value), code(value), nativeCode(error) {}
};

Object object(PJ *value) { return Object(value, proj_destroy); }
json text(const char *value) {
    if (!value) return nullptr;
    std::string result(value);
    for (auto &character : result) {
        if (character == '\n' || character == '\r' || character == '\t') character = ' ';
    }
    return result;
}

struct Context {
    PJ_CONTEXT *value = nullptr;
    std::string root;
    std::string found;
    std::set<std::string> names;
    std::string analyticProofId;

    explicit Context(const std::string &directory, const std::string &proofPath = "") : root(directory) {
        if (!proofPath.empty()) {
            const std::filesystem::path path(proofPath);
            const auto id = path.stem().string();
            if (id.size() != 67 || id.substr(0, 3) != "ap_" || path.extension() != ".json" ||
                !std::all_of(id.begin() + 3, id.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }) ||
                !std::filesystem::is_regular_file(path) || std::filesystem::is_symlink(path) ||
                std::filesystem::file_size(path) > 65536) throw Failure("APPLICABILITY_UNDETERMINED");
            std::ifstream file(path);
            const auto proof = json::parse(file);
            const json method = {{"authority", "EPSG"}, {"code", "9602"}};
            const json tolerances = {{"angularDegrees", 1e-9}, {"linearMetres", 0.002}};
            const json domain = {{"ellipsoid", "oblate-or-sphere"}, {"latitude", "open-poles"},
                {"longitude", "defined"}, {"normalBranch", "positive-polar-radius"}};
            if (proof.value("schemaVersion", 0) != 1 || proof.value("version", 0) != 1 ||
                proof.value("algorithm", "") != "epsg-9602-static-v1" || proof.value("method", json()) != method ||
                proof.value("tolerances", json()) != tolerances || proof.value("domain", json()) != domain)
                throw Failure("APPLICABILITY_UNDETERMINED");
            // The adapter verifies these document bytes against the complete release before spawning.
            analyticProofId = id;
        }
        for (const auto &entry : std::filesystem::directory_iterator(root)) {
            if (entry.is_regular_file() && !entry.is_symlink()) {
                names.insert(entry.path().filename().string());
            }
        }
        value = proj_context_create();
        proj_log_level(value, PJ_LOG_NONE);
        proj_context_set_enable_network(value, false);
        const char *paths[] = {root.c_str()};
        proj_context_set_search_paths(value, 1, paths);
        proj_context_set_file_finder(value, [](PJ_CONTEXT *, const char *name, void *data) {
            auto &self = *static_cast<Context *>(data);
            self.found = self.root + "/" + (self.names.count(name) ? name : ".unavailable");
            return self.found.c_str();
        }, this);
        const auto database = root + "/proj.db";
        const char *auxiliary[] = {nullptr};
        if (!proj_context_set_database_path(value, database.c_str(), auxiliary, nullptr)) {
            proj_context_destroy(value);
            value = nullptr;
            throw Failure("CATALOG_UNAVAILABLE");
        }
    }

    ~Context() { if (value) proj_context_destroy(value); }
};

json definition(Context &ctx, const PJ *value) {
    const char *options[] = {"MULTILINE=NO", nullptr};
    const char *result = proj_as_projjson(ctx.value, value, options);
    return result ? json::parse(result) : json(nullptr);
}

Object crs(Context &ctx, const std::string &id) {
    if (id.size() < 6 || id.size() > 20 || id.substr(0, 5) != "EPSG:" ||
        !std::all_of(id.begin() + 5, id.end(), [](unsigned char c) { return c >= '0' && c <= '9'; })) {
        throw Failure("INVALID_CRS_ID");
    }
    auto result = object(proj_create_from_database(ctx.value, "EPSG", id.substr(5).c_str(),
                                                 PJ_CATEGORY_CRS, false, nullptr));
    if (!result) throw Failure("CRS_NOT_FOUND");
    return result;
}

json areas(Context &ctx, const PJ *value) {
    json result = json::array();
    for (int index = 0; index < proj_get_domain_count(value); ++index) {
        double west, south, east, north;
        const char *name = nullptr;
        if (proj_get_area_of_use_ex(ctx.value, value, index, &west, &south, &east, &north, &name) &&
            std::isfinite(west) && std::isfinite(east) && std::isfinite(south) && std::isfinite(north) &&
            west >= -180 && east <= 180 && south >= -90 && north <= 90 && south <= north) {
            json entry = {{"name", text(name)}, {"bounds", {west, south, east, north}}};
            if (std::find(result.begin(), result.end(), entry) == result.end()) result.push_back(entry);
        } else {
            // An incomplete domain list cannot attest geographic applicability.
            return nullptr;
        }
    }
    return result.empty() ? json(nullptr) : result;
}

json axes(Context &ctx, const PJ *value) {
    json result = json::array();
    if (proj_get_type(value) == PJ_TYPE_COMPOUND_CRS) {
        for (int i = 0; i < 2; ++i) {
            auto sub = object(proj_crs_get_sub_crs(ctx.value, value, i));
            if (sub) for (const auto &axis : axes(ctx, sub.get())) result.push_back(axis);
        }
        return result;
    }
    auto cs = object(proj_crs_get_coordinate_system(ctx.value, value));
    if (!cs) return result;
    const auto structure = definition(ctx, value);
    const auto declared = structure.value("coordinate_system", json::object()).value("axis", json::array());
    for (int i = 0; i < proj_cs_get_axis_count(ctx.value, cs.get()); ++i) {
        const char *name, *abbreviation, *direction, *unit, *authority, *code;
        double factor;
        if (proj_cs_get_axis_info(ctx.value, cs.get(), i, &name, &abbreviation, &direction,
                                 &factor, &unit, &authority, &code)) {
            json meridian = nullptr;
            if (i < static_cast<int>(declared.size()) && declared[i].contains("meridian")) {
                const auto &longitude = declared[i]["meridian"]["longitude"];
                if (longitude.is_number()) {
                    meridian = {{"longitude", longitude}, {"unit", {{"name", "degree"}, {"toSI", std::acos(-1.0) / 180.0}}}};
                } else if (longitude.is_object() && longitude.contains("value") && longitude.contains("unit")) {
                    const auto &u = longitude["unit"];
                    if (u.is_object() && u.contains("conversion_factor")) {
                        meridian = {{"longitude", longitude["value"]}, {"unit", {{"name", u["name"]}, {"toSI", u["conversion_factor"]}}}};
                    }
                }
                if (meridian.is_null()) throw Failure("UNSUPPORTED_AXIS_PROFILE");
            }
            result.push_back({{"name", text(name)}, {"abbreviation", text(abbreviation)}, {"direction", text(direction)}, {"meridian", meridian},
                              {"unit", {{"name", text(unit)}, {"toSI", factor}}}});
        }
    }
    return result;
}

bool geographic(Context &ctx, const PJ *value) {
    if (proj_get_type(value) == PJ_TYPE_COMPOUND_CRS) {
        auto sub = object(proj_crs_get_sub_crs(ctx.value, value, 0));
        return sub && geographic(ctx, sub.get());
    }
    const auto type = proj_get_type(value);
    return type == PJ_TYPE_GEOGRAPHIC_2D_CRS || type == PJ_TYPE_GEOGRAPHIC_3D_CRS;
}

double angularToDegrees(Context &ctx, const PJ *value) {
    if (!geographic(ctx, value)) return 1;
    return axes(ctx, value).at(0).at("unit").at("toSI").get<double>() * 180.0 / std::acos(-1.0);
}

double primeMeridianDegrees(Context &ctx, const PJ *value) {
    auto meridian = object(proj_get_prime_meridian(ctx.value, value));
    double longitude, factor;
    const char *unit;
    if (!meridian || !proj_prime_meridian_get_parameters(ctx.value, meridian.get(), &longitude, &factor, &unit)) {
        throw Failure("APPLICABILITY_UNDETERMINED");
    }
    return longitude * factor * 180.0 / std::acos(-1.0);
}

std::string kind(const PJ *value) {
    switch (proj_get_type(value)) {
        case PJ_TYPE_GEOGRAPHIC_2D_CRS: return "geographic-2d";
        case PJ_TYPE_GEOGRAPHIC_3D_CRS: return "geographic-3d";
        case PJ_TYPE_PROJECTED_CRS: return "projected";
        case PJ_TYPE_COMPOUND_CRS: return "compound";
        case PJ_TYPE_GEOCENTRIC_CRS: return "geocentric";
        case PJ_TYPE_VERTICAL_CRS: return "vertical";
        case PJ_TYPE_ENGINEERING_CRS: return "engineering";
        default: return "other";
    }
}

Object horizontal(Context &ctx, const PJ *value) {
    return object(proj_get_type(value) == PJ_TYPE_COMPOUND_CRS
        ? proj_crs_get_sub_crs(ctx.value, value, 0) : proj_clone(ctx.value, value));
}

json coordinateModel(Context &ctx, const PJ *value) {
    auto h = horizontal(ctx, value);
    if (geographic(ctx, h.get())) return "geographic";
    if (proj_get_type(h.get()) == PJ_TYPE_PROJECTED_CRS) return "projected";
    if (proj_get_type(h.get()) == PJ_TYPE_GEOCENTRIC_CRS) return "geocentric";
    return nullptr;
}

struct AxisProfile {
    json normalized = nullptr;
    json mapping = nullptr;

    PJ_COORD toOfficial(PJ_COORD value) const {
        PJ_COORD result = value;
        for (size_t i = 0; i < mapping.size(); ++i) {
            result.v[mapping[i]["officialAxis"].get<int>()] = value.v[i] * mapping[i]["scale"].get<double>();
        }
        return result;
    }

    PJ_COORD toPublic(PJ_COORD value) const {
        PJ_COORD result = value;
        for (size_t i = 0; i < mapping.size(); ++i) {
            result.v[i] = value.v[mapping[i]["officialAxis"].get<int>()] / mapping[i]["scale"].get<double>();
        }
        return result;
    }

    json metadata() const {
        return mapping.is_null() ? json(nullptr) : json{{"method", "signed-permutation-v1"}, {"publicToOfficial", mapping}};
    }
};

// A polar direction is qualified by a meridian. Its basis follows the EPSG
// conversion's longitude of origin and hemisphere, never the axis name.
bool polarBasis(Context &ctx, const PJ *value, double &origin, double &hemisphere) {
    auto h = horizontal(ctx, value);
    if (proj_get_type(h.get()) != PJ_TYPE_PROJECTED_CRS) return false;
    auto conversion = object(proj_crs_get_coordoperation(ctx.value, h.get()));
    if (!conversion) return false;
    const char *name, *authority, *method;
    if (!proj_coordoperation_get_method_info(ctx.value, conversion.get(), &name, &authority, &method) ||
        !authority || std::string(authority) != "EPSG" || !method) return false;
    const std::string code(method);
    const bool standardParallel = code == "9829" || code == "9830";
    if (!standardParallel && code != "9810" && code != "9820" && code != "1027" && code != "1125") return false;
    bool hasOrigin = false, hasLatitude = false;
    for (int i = 0; i < proj_coordoperation_get_param_count(ctx.value, conversion.get()); ++i) {
        const char *paramAuthority, *paramCode, *valueString, *unitName, *unitAuthority, *unitCode, *category;
        double number, factor;
        if (!proj_coordoperation_get_param(ctx.value, conversion.get(), i, &name, &paramAuthority, &paramCode,
            &number, &valueString, &factor, &unitName, &unitAuthority, &unitCode, &category) ||
            !paramAuthority || std::string(paramAuthority) != "EPSG" || !paramCode || !category ||
            std::string(category) != "angular") continue;
        const std::string parameter(paramCode);
        const double degrees = number * factor * 180.0 / std::acos(-1.0);
        if (parameter == (standardParallel ? "8833" : "8802")) { origin = degrees; hasOrigin = true; }
        if (parameter == (standardParallel ? "8832" : "8801")) {
            if (!std::isfinite(degrees) || degrees == 0 || std::abs(degrees) > 90 ||
                (!standardParallel && std::abs(degrees) != 90)) return false;
            hemisphere = degrees > 0 ? 1 : -1;
            hasLatitude = true;
        }
    }
    return hasOrigin && hasLatitude && std::isfinite(origin);
}

AxisProfile axisProfile(Context &ctx, const PJ *value) {
    AxisProfile result;
    const auto official = axes(ctx, value);
    const auto model = coordinateModel(ctx, value);
    if (model.is_null() || official.size() < 2 || official.size() > 3 ||
        (model == "geocentric" && official.size() != 3)) return result;
    json normalized = json::array(), mapping = json::array();
    for (size_t i = 0; i < official.size(); ++i) { normalized.push_back(nullptr); mapping.push_back(nullptr); }
    double origin = 0, hemisphere = 0;
    const bool polar = polarBasis(ctx, value, origin, hemisphere);
    for (size_t index = 0; index < official.size(); ++index) {
        auto axis = official[index];
        const auto direction = axis["direction"].get<std::string>();
        const double unit = axis["unit"]["toSI"];
        if (!std::isfinite(unit) || unit <= 0) return result;
        int publicAxis = -1;
        double sign = 1;
        if (model == "geocentric") {
            if (!axis["meridian"].is_null()) return result;
            if (direction == "geocentricX") publicAxis = 0;
            if (direction == "geocentricY") publicAxis = 1;
            if (direction == "geocentricZ") publicAxis = 2;
        } else if (!axis["meridian"].is_null()) {
            if (!polar || index >= 2 || (direction != "north" && direction != "south")) return result;
            const auto &meridian = axis["meridian"];
            const double longitude = meridian["longitude"].get<double>() * meridian["unit"]["toSI"].get<double>() * 180.0 / std::acos(-1.0);
            const double quarter = std::remainder(longitude - origin, 360.0) / 90.0;
            // Only an exact signed permutation is admitted; no oblique axis is snapped to a basis.
            const double integer = std::round(quarter);
            if (std::abs(quarter - integer) > 32 * std::numeric_limits<double>::epsilon()) return result;
            const int quadrant = (static_cast<int>(integer) % 4 + 4) % 4;
            const double orientation = (direction == "north" ? -1 : 1) * hemisphere;
            publicAxis = quadrant % 2 == 1 ? 0 : 1;
            sign = orientation * (publicAxis == 0 ? (quadrant == 1 ? 1 : -1) : -hemisphere * (quadrant == 0 ? 1 : -1));
        } else {
            if (direction == "east" || direction == "west") { publicAxis = 0; sign = direction == "west" ? -1 : 1; }
            if (direction == "north" || direction == "south") { publicAxis = 1; sign = direction == "south" ? -1 : 1; }
            if (direction == "up" && index == 2) publicAxis = 2;
        }
        if (publicAxis < 0 || static_cast<size_t>(publicAxis) >= official.size() || !mapping[publicAxis].is_null()) return result;
        double scale = sign;
        if (model == "geographic" && publicAxis < 2) {
            if (!axis["meridian"].is_null()) return result;
            const double degree = std::acos(-1.0) / 180.0;
            scale *= degree / unit;
            axis["unit"] = {{"name", "degree"}, {"toSI", degree}};
        }
        if (model != "geocentric" && publicAxis < 2) {
            axis["name"] = model == "geographic" ? (publicAxis == 0 ? "Longitude" : "Latitude") : (publicAxis == 0 ? "Easting" : "Northing");
            axis["abbreviation"] = model == "geographic" ? (publicAxis == 0 ? "lon" : "lat") : (publicAxis == 0 ? "E" : "N");
            if (axis["meridian"].is_null()) axis["direction"] = publicAxis == 0 ? "east" : "north";
            else if (sign < 0) axis["direction"] = direction == "north" ? "south" : "north";
        }
        normalized[publicAxis] = axis;
        mapping[publicAxis] = {{"officialAxis", index}, {"scale", scale}};
    }
    if (std::any_of(mapping.begin(), mapping.end(), [](const json &axis) { return axis.is_null(); })) return result;
    result.normalized = normalized;
    result.mapping = mapping;
    return result;
}

json normalizedAxes(Context &ctx, const PJ *value) {
    return axisProfile(ctx, value).normalized;
}

json summary(Context &ctx, const PJ *value, const std::string &id) {
    const auto type = kind(value);
    const auto dimension = axes(ctx, value).size();
    const bool dynamic = definition(ctx, value).dump().find("frame_reference_epoch") != std::string::npos;
    json reasons = json::array();
    if (type == "vertical") reasons.push_back("VERTICAL_ONLY");
    else if (type == "engineering" || type == "other") reasons.push_back("UNSUPPORTED_CRS_TYPE");
    if (dynamic) reasons.push_back("DYNAMIC_CRS");
    if (dimension < 1 || dimension > 3) reasons.push_back("UNKNOWN_DIMENSION");
    if (normalizedAxes(ctx, value).is_null()) reasons.push_back("UNSUPPORTED_AXIS_PROFILE");
    return {{"id", id}, {"name", text(proj_get_name(value))}, {"kind", type},
            {"coordinateModel", coordinateModel(ctx, value)}, {"dimension", dimension >= 1 && dimension <= 3 ? json(dimension) : json(nullptr)},
            {"deprecated", proj_is_deprecated(value) != 0}, {"dynamic", dynamic},
            {"areasOfUse", areas(ctx, value)}, {"eligibility", {{"eligible", reasons.empty()}, {"reasons", reasons}}}};
}

json describe(Context &ctx, const PJ *value, const std::string &id, const json &formats) {
    json result = {{"summary", summary(ctx, value, id)}, {"officialAxes", axes(ctx, value)},
                   {"normalizedAxes", normalizedAxes(ctx, value)}, {"normalization", axisProfile(ctx, value).metadata()}, {"datum", nullptr},
                   {"ellipsoid", nullptr}, {"primeMeridian", nullptr}, {"definitions", json::array()}};
    auto h = horizontal(ctx, value);
    auto datum = object(proj_crs_get_datum_ensemble(ctx.value, h.get()));
    bool ensemble = static_cast<bool>(datum);
    if (!datum) datum = object(proj_crs_get_datum_forced(ctx.value, h.get()));
    if (datum) {
        const auto type = proj_get_type(datum.get());
        const bool dynamic = type == PJ_TYPE_DYNAMIC_GEODETIC_REFERENCE_FRAME || type == PJ_TYPE_DYNAMIC_VERTICAL_REFERENCE_FRAME;
        result["datum"] = {{"name", text(proj_get_name(datum.get()))},
            {"kind", dynamic ? "dynamic" : ensemble ? "ensemble" : "static"},
            {"referenceEpoch", dynamic ? json(proj_dynamic_datum_get_frame_reference_epoch(ctx.value, datum.get())) : json(nullptr)}};
    }
    auto ellipsoid = object(proj_get_ellipsoid(ctx.value, h.get()));
    double major, minor, inverseFlattening;
    int computed;
    if (ellipsoid && proj_ellipsoid_get_parameters(ctx.value, ellipsoid.get(), &major, &minor, &computed, &inverseFlattening)) {
        result["ellipsoid"] = {{"name", text(proj_get_name(ellipsoid.get()))},
            {"semiMajorMetres", major}, {"inverseFlattening", std::isfinite(inverseFlattening) && inverseFlattening >= 0 ? json(inverseFlattening) : json(nullptr)}};
    }
    auto meridian = object(proj_get_prime_meridian(ctx.value, h.get()));
    double longitude, factor;
    const char *unit;
    if (meridian && proj_prime_meridian_get_parameters(ctx.value, meridian.get(), &longitude, &factor, &unit)) {
        result["primeMeridian"] = {{"name", text(proj_get_name(meridian.get()))},
                                   {"longitudeDegrees", longitude * factor * 180.0 / std::acos(-1.0)}};
    }
    const char *options[] = {"MULTILINE=NO", nullptr};
    for (const auto &format : formats) {
        const char *content = format == "wkt2" ? proj_as_wkt(ctx.value, value, PJ_WKT2_2019, options)
                            : format == "projjson" ? proj_as_projjson(ctx.value, value, options)
                            : format == "legacy-proj" ? proj_as_proj_string(ctx.value, value, PJ_PROJ_5, nullptr) : nullptr;
        result["definitions"].push_back({{"format", format}, {"content", text(content)},
            {"lossy", format == "legacy-proj"}, {"unavailableReason", content ? json(nullptr) : json("NOT_REPRESENTABLE")}});
    }
    return result;
}

void supported(Context &ctx, const PJ *value) {
    const auto metadata = summary(ctx, value, "EPSG:1");
    if (!metadata["eligibility"]["eligible"].get<bool>()) {
        const auto &reasons = metadata["eligibility"]["reasons"];
        if (reasons.size() == 1 && reasons[0] == "UNSUPPORTED_AXIS_PROFILE") throw Failure("UNSUPPORTED_AXIS_PROFILE");
        throw Failure("UNSUPPORTED_CRS");
    }
}

std::string heightEffect(const std::string &pipeline, size_t dimension) {
    if (dimension == 2) return "none";
    if (pipeline.empty()) return "unknown";
    bool changed = false;
    std::vector<bool> saved;
    const std::set<std::string> horizontalOnly = {"pipeline", "noop", "unitconvert", "axisswap", "longlat", "latlong",
        "latlon", "lonlat", "hgridshift", "utm", "tmerc", "etmerc", "merc", "webmerc", "lcc", "sterea", "stere",
        "somerc", "omerc", "aea", "aeqd", "eqc", "eqdc", "laea", "krovak", "cass", "poly", "nzmg"};
    const std::set<std::string> heightOperations = {"cart", "helmert", "vgridshift", "xyzgridshift", "geogoffset", "vertoffset"};
    std::istringstream stream(pipeline);
    std::string token, step;
    while (stream >> token) {
        if (token.rfind("+proj=", 0) == 0) {
            step = token.substr(6);
            if (heightOperations.count(step)) changed = true;
            else if (step != "push" && step != "pop" && !horizontalOnly.count(step)) return "unknown";
        } else if (token == "+v_3" && step == "push") saved.push_back(changed);
        else if (token == "+v_3" && step == "pop") {
            if (saved.empty()) return "unknown";
            changed = saved.back();
            saved.pop_back();
        } else if (step == "unitconvert" && token.rfind("+z_", 0) == 0) changed = true;
        else if (step == "axisswap" && token.rfind("+order=", 0) == 0 &&
                 token != "+order=1,2" && token != "+order=2,1" &&
                 token != "+order=1,2,3" && token != "+order=2,1,3") return "unknown";
    }
    if (!saved.empty()) return "unknown";
    return changed ? "transformed" : "preserved";
}

Object datumOrEnsemble(Context &ctx, const PJ *value) {
    auto datum = object(proj_crs_get_datum_ensemble(ctx.value, value));
    if (!datum) datum = object(proj_crs_get_datum(ctx.value, value));
    return datum;
}

bool compatibleAnalyticPair(Context &ctx, const PJ *source, const PJ *target) {
    const auto a = proj_get_type(source), b = proj_get_type(target);
    if (!((a == PJ_TYPE_GEOGRAPHIC_3D_CRS && b == PJ_TYPE_GEOCENTRIC_CRS) ||
          (b == PJ_TYPE_GEOGRAPHIC_3D_CRS && a == PJ_TYPE_GEOCENTRIC_CRS))) return false;
    for (const auto *crs : {source, target}) {
        if (axes(ctx, crs).size() != 3 || axisProfile(ctx, crs).mapping.is_null() ||
            definition(ctx, crs).dump().find("frame_reference_epoch") != std::string::npos) return false;
    }
    auto datumA = datumOrEnsemble(ctx, source), datumB = datumOrEnsemble(ctx, target);
    auto ellipsoidA = object(proj_get_ellipsoid(ctx.value, source)), ellipsoidB = object(proj_get_ellipsoid(ctx.value, target));
    auto meridianA = object(proj_get_prime_meridian(ctx.value, source)), meridianB = object(proj_get_prime_meridian(ctx.value, target));
    return datumA && datumB && ellipsoidA && ellipsoidB && meridianA && meridianB &&
        proj_is_equivalent_to_with_ctx(ctx.value, datumA.get(), datumB.get(), PJ_COMP_EQUIVALENT) &&
        proj_is_equivalent_to_with_ctx(ctx.value, ellipsoidA.get(), ellipsoidB.get(), PJ_COMP_EQUIVALENT) &&
        proj_is_equivalent_to_with_ctx(ctx.value, meridianA.get(), meridianB.get(), PJ_COMP_EQUIVALENT);
}

bool hasAnalyticProof(Context &ctx, const PJ *value) {
    if (ctx.analyticProofId.empty() || proj_get_type(value) != PJ_TYPE_CONVERSION ||
        proj_coordoperation_has_ballpark_transformation(ctx.value, value) ||
        proj_coordoperation_requires_per_coordinate_input_time(ctx.value, value) ||
        proj_coordoperation_get_grid_used_count(ctx.value, value) != 0) return false;
    const char *name, *authority, *code;
    if (!proj_coordoperation_get_method_info(ctx.value, value, &name, &authority, &code) || !authority || !code ||
        (std::string(authority) != "EPSG" && std::string(authority) != "INVERSE(EPSG)") || std::string(code) != "9602") return false;
    auto source = object(proj_get_source_crs(ctx.value, value));
    auto target = object(proj_get_target_crs(ctx.value, value));
    return source && target && compatibleAnalyticPair(ctx, source.get(), target.get());
}

struct Ellipsoid {
    double a, b, e2;
};

Ellipsoid ellipsoidParameters(Context &ctx, const PJ *value) {
    auto ellipsoid = object(proj_get_ellipsoid(ctx.value, value));
    double a, b, inverseFlattening;
    int computed;
    if (!ellipsoid || !proj_ellipsoid_get_parameters(ctx.value, ellipsoid.get(), &a, &b, &computed, &inverseFlattening) ||
        !std::isfinite(a) || !std::isfinite(b) || a <= 0 || b <= 0 || b > a)
        throw Failure("APPLICABILITY_UNDETERMINED");
    return {a, b, 1 - (b / a) * (b / a)};
}

void verifyCartesianEquation(Context &ctx, const PJ *geographicCrs, PJ_COORD geographicCoordinate,
                             const PJ *geocentricCrs, PJ_COORD geocentricCoordinate) {
    if (ctx.analyticProofId.empty() || !compatibleAnalyticPair(ctx, geographicCrs, geocentricCrs))
        throw Failure("APPLICABILITY_UNDETERMINED");
    const auto geoAxes = axisProfile(ctx, geographicCrs), cartAxes = axisProfile(ctx, geocentricCrs);
    const auto geo = geoAxes.toPublic(geographicCoordinate), cart = cartAxes.toPublic(geocentricCoordinate);
    const auto ellipsoid = ellipsoidParameters(ctx, geographicCrs);
    const double longitude = geo.xyz.x * std::acos(-1.0) / 180;
    const double latitude = geo.xyz.y * std::acos(-1.0) / 180;
    const double height = geo.xyz.z * geoAxes.normalized[2]["unit"]["toSI"].get<double>();
    if (!std::isfinite(longitude) || !std::isfinite(latitude) || !std::isfinite(height) || std::abs(geo.xyz.y) >= 90)
        throw Failure("APPLICABILITY_UNDETERMINED");
    const double n = ellipsoid.a / std::sqrt(1 - ellipsoid.e2 * std::sin(latitude) * std::sin(latitude));
    if (!(n * (1 - ellipsoid.e2) + height > 0)) throw Failure("APPLICABILITY_UNDETERMINED");
    const double expected[] = {(n + height) * std::cos(latitude) * std::cos(longitude),
        (n + height) * std::cos(latitude) * std::sin(longitude),
        (n * (1 - ellipsoid.e2) + height) * std::sin(latitude)};
    double metric[3];
    for (int i = 0; i < 3; ++i) {
        metric[i] = cart.v[i] * cartAxes.normalized[i]["unit"]["toSI"].get<double>();
        if (!std::isfinite(metric[i]) || !std::isfinite(expected[i]) || std::abs(metric[i] - expected[i]) > 0.002)
            throw Failure("APPLICABILITY_UNDETERMINED");
    }
    if (!(std::hypot(metric[0], metric[1]) > 0)) throw Failure("APPLICABILITY_UNDETERMINED");
}

void verifyCoordinateClosure(Context &ctx, const PJ *crs, PJ_COORD expected, PJ_COORD actual) {
    const auto profile = axisProfile(ctx, crs);
    const auto a = profile.toPublic(expected), b = profile.toPublic(actual);
    for (int i = 0; i < 3; ++i) {
        const double difference = geographic(ctx, crs) && i == 0 ? std::remainder(a.v[i] - b.v[i], 360.0) : a.v[i] - b.v[i];
        const double factor = geographic(ctx, crs) && i < 2 ? 1 : profile.normalized[i]["unit"]["toSI"].get<double>();
        const double tolerance = geographic(ctx, crs) && i < 2 ? 1e-9 : 0.002;
        if (!std::isfinite(difference) || !std::isfinite(difference * factor) || std::abs(difference * factor) > tolerance)
            throw Failure("APPLICABILITY_UNDETERMINED");
    }
}

void verifyAnalyticExecution(Context &ctx, const PJ *operation, const PJ *source, const PJ *target,
                            PJ_COORD input, PJ_COORD output) {
    if (!hasAnalyticProof(ctx, operation) || !compatibleAnalyticPair(ctx, source, target))
        throw Failure("APPLICABILITY_UNDETERMINED");
    if (geographic(ctx, source)) verifyCartesianEquation(ctx, source, input, target, output);
    else verifyCartesianEquation(ctx, target, output, source, input);
    proj_errno_reset(const_cast<PJ *>(operation));
    const auto inverse = proj_trans(const_cast<PJ *>(operation), PJ_INV, output);
    if (proj_errno(operation)) throw Failure("APPLICABILITY_UNDETERMINED");
    verifyCoordinateClosure(ctx, source, input, inverse);
    proj_errno_reset(const_cast<PJ *>(operation));
    const auto repeated = proj_trans(const_cast<PJ *>(operation), PJ_FWD, inverse);
    if (proj_errno(operation)) throw Failure("APPLICABILITY_UNDETERMINED");
    verifyCoordinateClosure(ctx, target, output, repeated);
}

json operation(Context &ctx, const PJ *value, size_t dimension = 2, bool cartesianPair = false) {
    const auto accuracy = proj_coordoperation_get_accuracy(ctx.value, value);
    json grids = json::array();
    std::set<std::string> names;
    for (int i = 0; i < proj_coordoperation_get_grid_used_count(ctx.value, value); ++i) {
        const char *name, *full, *package, *url;
        int direct, open, available;
        if (proj_coordoperation_get_grid_used(ctx.value, value, i, &name, &full, &package, &url,
                                            &direct, &open, &available) && name && names.insert(name).second) {
            grids.push_back({{"name", name}, {"available", available != 0}});
        }
    }
    const char *raw = proj_as_proj_string(ctx.value, value, PJ_PROJ_5, nullptr);
    const std::string pipeline = raw ? raw : "";
    const auto height = heightEffect(pipeline, dimension);
    // Optional grids and time-dependent operators cannot silently change applicability.
    const bool supported = raw && !proj_coordoperation_requires_per_coordinate_input_time(ctx.value, value) && pipeline.find("+grids=@") == std::string::npos &&
        pipeline.find(",@") == std::string::npos && pipeline.find("+proj=deformation") == std::string::npos &&
        pipeline.find("+t_epoch=") == std::string::npos && pipeline.find("+t_final=") == std::string::npos &&
        pipeline.find("+dt=") == std::string::npos && height != "unknown";
    json identifiers = json::array();
    for (int index = 0; proj_get_id_auth_name(value, index); ++index) {
        identifiers.push_back({{"authority", text(proj_get_id_auth_name(value, index))},
                               {"code", text(proj_get_id_code(value, index))}});
    }
    return {{"name", text(proj_get_name(value))}, {"accuracy", accuracy < 0 ? json(nullptr) : json(accuracy)},
            {"ballpark", proj_coordoperation_has_ballpark_transformation(ctx.value, value) != 0},
            {"areasOfUse", areas(ctx, value)}, {"grids", grids}, {"identifiers", identifiers},
            {"methodSupported", supported}, {"instantiable", supported && proj_coordoperation_is_instantiable(ctx.value, value) != 0},
            {"hasInverse", proj_pj_info(const_cast<PJ *>(value)).has_inverse != 0}, {"heightEffect", cartesianPair ? "not-applicable" : height},
            {"analyticProofId", areas(ctx, value).is_null() && hasAnalyticProof(ctx, value) ? json(ctx.analyticProofId) : json(nullptr)},
            {"internalPipeline", raw ? json(pipeline) : json(nullptr)}};
}

Objects candidates(Context &ctx, const PJ *source, const PJ *target, const json &request, bool applyPolicy = false, bool availableOnly = false) {
    auto factory = std::unique_ptr<PJ_OPERATION_FACTORY_CONTEXT,
                                  decltype(&proj_operation_factory_context_destroy)>(
        proj_create_operation_factory_context(ctx.value, nullptr), proj_operation_factory_context_destroy);
    proj_operation_factory_context_set_grid_availability_use(ctx.value, factory.get(), availableOnly ? PROJ_GRID_AVAILABILITY_DISCARD_OPERATION_IF_MISSING_GRID : PROJ_GRID_AVAILABILITY_IGNORED);
    proj_operation_factory_context_set_crs_extent_use(ctx.value, factory.get(), PJ_CRS_EXTENT_NONE);
    proj_operation_factory_context_set_spatial_criterion(ctx.value, factory.get(), PROJ_SPATIAL_CRITERION_PARTIAL_INTERSECTION);
    proj_operation_factory_context_set_allow_ballpark_transformations(ctx.value, factory.get(),
        applyPolicy ? request.value("allowBallpark", false) : true);
    return Objects(proj_create_operations(ctx.value, source, target, factory.get()), proj_list_destroy);
}

Object transformer(Context &ctx, const PJ *source, const PJ *target, const json &request) {
    const char *options[] = {
        request.value("allowBallpark", false) ? "ALLOW_BALLPARK=YES" : "ALLOW_BALLPARK=NO",
        request.value("requireBestKnown", true) ? "ONLY_BEST=YES" : "ONLY_BEST=NO", nullptr};
    auto aoi = std::unique_ptr<PJ_AREA, decltype(&proj_area_destroy)>(nullptr, proj_area_destroy);
    if (request.contains("areaOfInterest")) {
        const auto &a = request["areaOfInterest"];
        if (!a.is_array() || a.size() != 4) throw Failure("INVALID_AREA");
        aoi.reset(proj_area_create());
        proj_area_set_bbox(aoi.get(), a[0], a[1], a[2], a[3]);
    }
    auto raw = object(proj_create_crs_to_crs_from_pj(ctx.value, source, target, aoi.get(), options));
    if (!raw) {
        auto list = candidates(ctx, source, target, request, true);
        for (int i = 0; i < proj_list_get_count(list.get()); ++i) {
            auto item = object(proj_list_get(ctx.value, list.get(), i));
            const auto metadata = operation(ctx, item.get());
            for (const auto &grid : metadata["grids"]) {
                if (!grid["available"].get<bool>()) throw Failure("MISSING_GRID");
            }
        }
        throw Failure("NO_USABLE_TRANSFORMATION");
    }
    return raw;
}

bool contains(const json &domains, double longitude, double latitude, double tolerance = 0) {
    if (domains.is_null() || domains.empty()) throw Failure("APPLICABILITY_UNDETERMINED");
    for (const auto &domain : domains) {
        const auto &b = domain["bounds"];
        const double west = b[0], south = b[1], east = b[2], north = b[3];
        const bool insideLongitude = west <= east ? longitude >= west - tolerance && longitude <= east + tolerance
                                                 : longitude >= west - tolerance || longitude <= east + tolerance;
        if (insideLongitude && latitude >= south - tolerance && latitude <= north + tolerance) return true;
    }
    return false;
}

double locatorRoundoff(const std::pair<double, double> &point) {
    // Only derived locator values need an IEEE-754 rounding allowance, not raw geographic inputs.
    return 64 * std::numeric_limits<double>::epsilon() * std::max({1.0, std::abs(point.first), std::abs(point.second)});
}

json catalog(Context &ctx, const json &request) {
    sqlite3 *raw = nullptr;
    const auto path = ctx.root + "/proj.db";
    if (sqlite3_open_v2(path.c_str(), &raw, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nullptr) != SQLITE_OK) {
        if (raw) sqlite3_close(raw);
        throw Failure("CATALOG_UNAVAILABLE");
    }
    auto db = std::unique_ptr<sqlite3, decltype(&sqlite3_close)>(raw, sqlite3_close);
    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db.get(), "SELECT table_name, code FROM crs_view WHERE auth_name='EPSG' ORDER BY CAST(code AS INTEGER) LIMIT ? OFFSET ?", -1, &statement, nullptr) != SQLITE_OK) throw Failure("CATALOG_UNAVAILABLE");
    auto rows = std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)>(statement, sqlite3_finalize);
    const int offset = request.value("offset", 0);
    if (offset < 0 || offset > 100000) throw Failure("INVALID_REQUEST");
    sqlite3_bind_int(rows.get(), 1, 50);
    sqlite3_bind_int(rows.get(), 2, offset);
    json result = json::array();
    int status;
    while ((status = sqlite3_step(rows.get())) == SQLITE_ROW) {
        const std::string table = reinterpret_cast<const char *>(sqlite3_column_text(rows.get(), 0));
        const std::string code = reinterpret_cast<const char *>(sqlite3_column_text(rows.get(), 1));
        auto value = crs(ctx, "EPSG:" + code);
        json aliases = json::array();
        sqlite3_stmt *aliasStatement = nullptr;
        if (sqlite3_prepare_v2(db.get(), "SELECT DISTINCT alt_name FROM alias_name WHERE auth_name='EPSG' AND table_name=? AND code=? ORDER BY alt_name", -1, &aliasStatement, nullptr) != SQLITE_OK) throw Failure("CATALOG_UNAVAILABLE");
        auto aliasRows = std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)>(aliasStatement, sqlite3_finalize);
        sqlite3_bind_text(aliasRows.get(), 1, table.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(aliasRows.get(), 2, code.c_str(), -1, SQLITE_TRANSIENT);
        while (sqlite3_step(aliasRows.get()) == SQLITE_ROW) aliases.push_back(reinterpret_cast<const char *>(sqlite3_column_text(aliasRows.get(), 0)));
        result.push_back({{"description", describe(ctx, value.get(), "EPSG:" + code, json::array())}, {"aliases", aliases}});
    }
    if (status != SQLITE_DONE) throw Failure("CATALOG_UNAVAILABLE");
    return result;
}

struct Locator {
    Context &ctx;
    Object horizontalCrs;
    Object geodetic;
    Object transform;
    AxisProfile outputAxes;
    bool geocentric;
    double meridian;

    Locator(Context &context, const PJ *source) : ctx(context), horizontalCrs(horizontal(ctx, source)),
        geodetic(object(proj_crs_get_geodetic_crs(ctx.value, horizontalCrs.get()))),
        transform(nullptr, proj_destroy), geocentric(proj_get_type(source) == PJ_TYPE_GEOCENTRIC_CRS), meridian(0) {
        if (!geodetic) throw Failure("APPLICABILITY_UNDETERMINED");
        if (proj_get_type(geodetic.get()) == PJ_TYPE_GEOCENTRIC_CRS) {
            auto datum = object(proj_crs_get_datum_ensemble(ctx.value, geodetic.get()));
            if (!datum) datum = object(proj_crs_get_datum(ctx.value, geodetic.get()));
            auto cs = object(proj_create_ellipsoidal_3D_cs(ctx.value, PJ_ELLPS3D_LONGITUDE_LATITUDE_HEIGHT,
                "degree", std::acos(-1.0) / 180.0, "metre", 1));
            if (!datum || !cs) throw Failure("APPLICABILITY_UNDETERMINED");
            // Preserve the exact datum/ensemble, ellipsoid and prime meridian; no datum transform.
            geodetic = object(proj_create_geographic_crs_from_datum(ctx.value, "Applicability geographic CRS", datum.get(), cs.get()));
            if (!geodetic) throw Failure("APPLICABILITY_UNDETERMINED");
        }
        if (geocentric) {
            auto conversions = candidates(ctx, horizontalCrs.get(), geodetic.get(), json::object(), true);
            if (proj_list_get_count(conversions.get()) != 1) throw Failure("APPLICABILITY_UNDETERMINED");
            transform = object(proj_list_get(ctx.value, conversions.get(), 0));
        } else transform = transformer(ctx, horizontalCrs.get(), geodetic.get(), json::object());
        outputAxes = axisProfile(ctx, geodetic.get());
        if (outputAxes.mapping.is_null()) throw Failure("APPLICABILITY_UNDETERMINED");
        meridian = primeMeridianDegrees(ctx, geodetic.get());
    }

    std::pair<double, double> locate(PJ_COORD coordinate) {
        if (geocentric && coordinate.xyz.x == 0 && coordinate.xyz.y == 0 && coordinate.xyz.z == 0)
            throw Failure("APPLICABILITY_UNDETERMINED");
        proj_errno_reset(transform.get());
        const auto raw = proj_trans(transform.get(), PJ_FWD, coordinate);
        const auto result = outputAxes.toPublic(raw);
        if (proj_errno(transform.get()) || !std::isfinite(result.xy.x) || !std::isfinite(result.xy.y)) throw Failure("APPLICABILITY_UNDETERMINED");
        if (geocentric) verifyAnalyticExecution(ctx, transform.get(), horizontalCrs.get(), geodetic.get(), coordinate, raw);
        if (std::abs(result.xy.y) > 90) throw Failure("APPLICABILITY_UNDETERMINED");
        return {std::remainder(result.xy.x + meridian, 360.0), result.xy.y};
    }
};

json execute(Context &ctx, const json &request) {
    const auto command = request.at("command").get<std::string>();
    if (command == "metadata") return {{"engine", proj_info().version}, {"networkEnabled", proj_context_is_network_enabled(ctx.value) != 0},
        {"catalog", text(proj_context_get_database_metadata(ctx.value, "EPSG.VERSION"))},
        {"analyticProofId", ctx.analyticProofId.empty() ? json(nullptr) : json(ctx.analyticProofId)}};
    if (command == "catalog") return catalog(ctx, request);
    if (command == "describe") {
        const auto id = request.at("id").get<std::string>();
        auto value = crs(ctx, id);
        return describe(ctx, value.get(), id, request.value("formats", json::array()));
    }
    auto source = crs(ctx, request.at("from"));
    auto target = crs(ctx, request.at("to"));
    supported(ctx, source.get());
    supported(ctx, target.get());
    const auto sourceDimension = axes(ctx, source.get()).size();
    const auto targetDimension = axes(ctx, target.get()).size();
    if (sourceDimension != targetDimension) throw Failure("CRS_DIMENSION_MISMATCH");
    const bool cartesianPair = proj_get_type(source.get()) == PJ_TYPE_GEOCENTRIC_CRS || proj_get_type(target.get()) == PJ_TYPE_GEOCENTRIC_CRS;
    const auto sourceAxes = axisProfile(ctx, source.get());
    const auto targetAxes = axisProfile(ctx, target.get());
    auto known = candidates(ctx, source.get(), target.get(), request);
    const int count = proj_list_get_count(known.get());
    if (count > 4096) throw Failure("CATALOG_UNAVAILABLE");

    if (command == "operations") {
        json result = json::array();
        for (int i = 0; i < count; ++i) {
            auto value = object(proj_list_get(ctx.value, known.get(), i));
            auto item = operation(ctx, value.get(), sourceDimension, cartesianPair);
            item["index"] = i;
            result.push_back(item);
        }
        return result;
    }
    if (command != "transform") throw Failure("INVALID_COMMAND");
    const auto &positions = request.at("positions");
    if (!positions.is_array() || positions.empty() || positions.size() > 50) throw Failure("BATCH_SIZE");
    const auto dimension = positions[0].size();
    if ((dimension != 2 && dimension != 3) || (sourceDimension == 3 && dimension != 3)) throw Failure("UNSUPPORTED_DIMENSION");
    auto policyKnown = candidates(ctx, source.get(), target.get(), request, true);
    auto available = candidates(ctx, source.get(), target.get(), request, true, true);
    Locator sourceLocator(ctx, source.get());
    Locator targetLocator(ctx, target.get());
    const auto sourceAreas = areas(ctx, source.get());
    const auto targetAreas = areas(ctx, target.get());
    const bool explicitSelection = request.contains("operationIndex");
    json result = json::array();

    for (size_t i = 0; i < positions.size(); ++i) {
        try {
            const auto &position = positions[i];
            if (!position.is_array() || position.size() != dimension) throw Failure("INVALID_COORDINATE");
            for (const auto &number : position) if (!number.is_number() || !std::isfinite(number.get<double>())) throw Failure("INVALID_COORDINATE");
            if (geographic(ctx, source.get()) && (std::abs(position[0].get<double>()) > 180 || std::abs(position[1].get<double>()) > 90)) throw Failure("OUTSIDE_EXECUTION_DOMAIN");
            const auto coordinate = sourceAxes.toOfficial(proj_coord(position[0].get<double>(), position[1].get<double>(),
                sourceDimension == 3 ? position[2].get<double>() : 0, HUGE_VAL));
            const auto location = sourceLocator.locate(coordinate);
            const double sourceRoundoff = geographic(ctx, source.get()) ? 0 : locatorRoundoff(location);
            if (!contains(sourceAreas, location.first, location.second, sourceRoundoff)) throw Failure("OUTSIDE_CRS_AREA");
            const int bestIndex = proj_get_suggested_operation(ctx.value, policyKnown.get(), PJ_FWD, coordinate);
            if (bestIndex < 0) {
                const int any = proj_get_suggested_operation(ctx.value, known.get(), PJ_FWD, coordinate);
                if (any >= 0 && !request.value("allowBallpark", false)) throw Failure("BALLPARK_NOT_ALLOWED");
                throw Failure("BEST_KNOWN_UNDETERMINED");
            }
            auto bestRaw = object(proj_list_get(ctx.value, policyKnown.get(), bestIndex));
            auto best = operation(ctx, bestRaw.get(), sourceDimension, cartesianPair);
            Object selectedRaw(nullptr, proj_destroy);
            if (explicitSelection) {
                const int index = request.at("operationIndex");
                if (index < 0 || index >= count) throw Failure("OPERATION_NOT_FOUND");
                selectedRaw = object(proj_list_get(ctx.value, known.get(), index));
            } else if (request.value("requireBestKnown", true)) selectedRaw = object(proj_clone(ctx.value, bestRaw.get()));
            else {
                const int index = proj_get_suggested_operation(ctx.value, available.get(), PJ_FWD, coordinate);
                if (index < 0) throw Failure("NO_OPERATION");
                selectedRaw = object(proj_list_get(ctx.value, available.get(), index));
            }
            auto selected = std::move(selectedRaw);
            auto metadata = operation(ctx, selected.get(), sourceDimension, cartesianPair);
            if (metadata["ballpark"].get<bool>() && !request.value("allowBallpark", false)) throw Failure("BALLPARK_NOT_ALLOWED");
            json missing = json::array();
            for (const auto &grid : metadata["grids"]) if (!grid["available"].get<bool>()) missing.push_back(grid["name"]);
            if (!missing.empty()) {
                Failure failure("MISSING_GRID");
                failure.details["missingGrids"] = missing;
                throw failure;
            }
            if (!metadata["instantiable"].get<bool>()) throw Failure("OPERATION_UNUSABLE");
            const bool analytical = !metadata["analyticProofId"].is_null();
            if (metadata["areasOfUse"].is_null()) {
                if (!analytical) throw Failure("APPLICABILITY_UNDETERMINED");
            } else if (!contains(metadata["areasOfUse"], location.first, location.second, sourceRoundoff)) throw Failure("OUTSIDE_OPERATION_AREA");
            proj_errno_reset(selected.get());
            const auto output = proj_trans(selected.get(), PJ_FWD, coordinate);
            const auto error = proj_errno(selected.get());
            if (error == PROJ_ERR_INVALID_OP_FILE_NOT_FOUND_OR_INVALID) throw Failure("MISSING_GRID");
            if (error == PROJ_ERR_COORD_TRANSFM_OUTSIDE_GRID) throw Failure("OUTSIDE_GRID");
            if (error == PROJ_ERR_COORD_TRANSFM_GRID_AT_NODATA) throw Failure("GRID_NODATA");
            if (error == PROJ_ERR_COORD_TRANSFM_MISSING_TIME) throw Failure("UNSUPPORTED_EPOCH");
            if (error || !std::isfinite(output.xy.x) || !std::isfinite(output.xy.y) ||
                (dimension == 3 && !std::isfinite(output.xyz.z))) throw Failure("OUTSIDE_EXECUTION_DOMAIN");
            if (analytical) verifyAnalyticExecution(ctx, selected.get(), source.get(), target.get(), coordinate, output);
            const auto targetLocation = targetLocator.locate(output);
            const double targetRoundoff = locatorRoundoff(targetLocation);
            if (!contains(targetAreas, targetLocation.first, targetLocation.second, targetRoundoff)) throw Failure("OUTSIDE_TARGET_CRS_AREA");
            if (!metadata["areasOfUse"].is_null() && !contains(metadata["areasOfUse"], targetLocation.first, targetLocation.second, targetRoundoff)) throw Failure("APPLICABILITY_UNDETERMINED");
            const auto publicOutput = targetAxes.toPublic(output);
            json transformed = {publicOutput.xy.x, publicOutput.xy.y};
            if (dimension == 3) transformed.push_back(sourceDimension == 2 ? position[2].get<double>() : publicOutput.xyz.z);
            result.push_back({{"position", transformed}, {"operation", metadata}, {"bestKnown", best},
                {"analyticProofVerified", analytical},
                {"height", cartesianPair ? "not-applicable" : dimension == 2 ? "absent" : sourceDimension == 2 ? "auxiliary-preserved"
                    : metadata["heightEffect"] == "transformed" ? "transformed" : "crs-preserved"}});
        } catch (Failure &failure) {
            failure.index = static_cast<int>(i);
            throw;
        }
    }
    return result;
}

int main(int argc, char **argv) {
    if (argc != 2 && argc != 3) return 2;
    for (const char *name : {"PROJ_DATA", "PROJ_LIB", "PROJ_AUX_DB", "PROJ_NETWORK", "PROJ_NETWORK_ENDPOINT"}) unsetenv(name);
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            if (line.size() > 32768) throw Failure("BODY_TOO_LARGE");
            Context context(std::filesystem::absolute(argv[1]).string(), argc == 3 ? argv[2] : "");
            std::cout << json({{"ok", true}, {"result", execute(context, json::parse(line))}}).dump() << '\n';
        } catch (const Failure &failure) {
            std::cout << json({{"ok", false}, {"code", failure.code}, {"index", failure.index}, {"details", failure.details}}).dump() << '\n';
        } catch (const std::exception &) {
            std::cout << "{\"ok\":false,\"code\":\"INVALID_REQUEST\",\"index\":-1}\n";
        }
        std::cout.flush();
    }
}
