import Foundation

/// Solar position and illumination using the same NOAA equations and units as the map compiler.
enum NativeSun {
  struct Direction: Equatable {
    let azimuth: Double
    let altitude: Double
    var json: JSONValue { .object(["azimuth": .number(azimuth), "altitude": .number(altitude)]) }

    init(_ azimuth: Double, _ altitude: Double) {
      self.azimuth = NativeEvaluators.normalizedAzimuth(azimuth)
      self.altitude = max(-90, min(90, altitude))
    }

    init?(_ value: JSONValue?) {
      guard let a = value?["azimuth"]?.number, let h = value?["altitude"]?.number else {
        return nil
      }
      self.init(a, h)
    }

    func toward(_ target: Direction, _ t: Double) -> Direction {
      Direction(NativeEvaluators.mixSuns(json, target.json, t)) ?? target
    }
  }

  static func position(date: Double, location: TileflowCoordinate) -> Direction {
    let deg = Double.pi / 180
    let t = (date / 86_400_000 + 2_440_587.5 - 2_451_545) / 36_525
    let l0 = NativeEvaluators.normalizedAzimuth(280.46646 + t * (36_000.76983 + t * 0.0003032))
    let m = (357.52911 + t * (35_999.05029 - 0.0001537 * t)) * deg
    let e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    let centre =
      sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * m) * (0.019993 - 0.000101 * t)
      + sin(3 * m) * 0.000289
    let omega = (125.04 - 1934.136 * t) * deg
    let apparent = (l0 + centre - 0.00569 - 0.00478 * sin(omega)) * deg
    let obliquity =
      (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256
        * cos(omega)) * deg
    let declination = asin(sin(obliquity) * sin(apparent))
    let y = pow(tan(obliquity / 2), 2)
    let l = l0 * deg
    let equation =
      4 / deg
      * (y * sin(2 * l) - 2 * e * sin(m) + 4 * e * y * sin(m) * cos(2 * l) - 0.5 * y * y
        * sin(4 * l) - 1.25 * e * e * sin(2 * m))
    func wrap(_ x: Double, _ period: Double) -> Double {
      (x.truncatingRemainder(dividingBy: period) + period).truncatingRemainder(dividingBy: period)
    }
    let minutes = wrap(date, 86_400_000) / 60_000
    let hour = (wrap(minutes + equation + 4 * location.longitude, 1440) / 4 - 180) * deg
    let latitude = location.latitude * deg
    let zenith = acos(
      max(
        -1, min(1, sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hour)))
    )
    let elevation = 90 - zenith / deg
    let azimuth =
      atan2(sin(hour), cos(hour) * sin(latitude) - tan(declination) * cos(latitude)) / deg + 180
    let tanE = tan(elevation * deg)
    let seconds: Double
    if elevation > 85 {
      seconds = 0
    } else if elevation > 5 {
      seconds = 58.1 / tanE - 0.07 / pow(tanE, 3) + 0.000086 / pow(tanE, 5)
    } else if elevation > -0.575 {
      seconds =
        1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
    } else {
      seconds = -20.772 / tanE
    }
    return Direction(azimuth, elevation + seconds / 3600)
  }

  static func resolve(_ direction: Direction, preset: JSONValue, source: String = "date")
    -> JSONValue
  {
    let deg = Double.pi / 180
    let a = direction.azimuth * deg
    let h = direction.altitude * deg
    let t = min(1, max(0, (direction.altitude + 0.5) / 3.5))
    let intensity = (preset["intensity"]?.number ?? 0.2) * (t * t * (3 - 2 * t))
    let ambient = preset["ambient"]?["intensity"]?.number ?? 0.8
    func rgb(_ color: JSONValue?) -> [Double] {
      Array(
        (NativeEvaluators.parseColour(color?.string ?? "#ffffff") ?? [255, 255, 255]).prefix(3)
      ).map { $0 / 255 }
    }
    func luminance(_ color: [Double]) -> Double {
      let linear = color.map { $0 <= 0.04045 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    let direct = rgb(preset["color"])
    let indirect = rgb(preset["ambient"]?["color"])
    let brightness =
      (luminance(indirect) * ambient + luminance(direct) * intensity * max(0, sin(h))) / 2
    return .object([
      "azimuth": .number(direction.azimuth), "altitude": .number(direction.altitude),
      "direction": .array([sin(a) * cos(h), cos(a) * cos(h), sin(h)].map(JSONValue.number)),
      "source": .string(source), "color": preset["color"] ?? .string("#ffffff"),
      "rgb": .array(direct.map(JSONValue.number)), "intensity": .number(intensity),
      "shadowIntensity": preset["shadowIntensity"] ?? .number(1),
      "ambient": .object([
        "color": preset["ambient"]?["color"] ?? .string("#ffffff"),
        "rgb": .array(indirect.map(JSONValue.number)), "intensity": .number(ambient),
      ]),
      "brightness": .number((brightness * 1_000_000).rounded() / 1_000_000),
    ])
  }
}
