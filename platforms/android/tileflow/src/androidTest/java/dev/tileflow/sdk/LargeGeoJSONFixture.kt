package dev.tileflow.sdk

/** A FeatureCollection of points of at least [bytes], and its feature count. */
internal fun largeFeatureCollection(bytes: Int): Pair<String, Int> {
    val text = StringBuilder("""{"type":"FeatureCollection","features":[""")
    var count = 0
    while (text.length < bytes) {
        if (count > 0) text.append(',')
        val longitude = -3.75 + (count % 1000) / 10_000.0
        val latitude = 40.40 + (count / 1000) / 1000.0
        text.append(
            """{"type":"Feature","id":$count,"properties":{"name":"Point $count","rank":${count % 7}},"geometry":{"type":"Point","coordinates":[$longitude,$latitude]}}"""
        )
        count += 1
    }
    return text.append("]}").toString() to count
}
