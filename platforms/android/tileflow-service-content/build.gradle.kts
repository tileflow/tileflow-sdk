plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.dokka")
    id("maven-publish")
}

android {
    namespace = "dev.tileflow.servicecontent"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { targetSdk = 36 }
    sourceSets["test"].java.srcDir("../tileflow-configuration/src/testShared/java")
    sourceSets["test"].resources.srcDir("../../ios/Tests/TileflowServiceTests/Fixtures")
    publishing { singleVariant("release") { withSourcesJar() } }
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

dependencies {
    api(project(":tileflow"))
    api(project(":tileflow-search"))
    api(project(":tileflow-routing"))
    api(project(":tileflow-elevation"))
    api(project(":tileflow-geoip"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

// Coordinates, POM and the local candidate repository: platforms/native-release.json.
apply(from = rootProject.file("gradle/publishing.gradle.kts"))
