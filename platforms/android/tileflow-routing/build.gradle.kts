plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.dokka")
    id("maven-publish")
}

group = "dev.tileflow"

version = providers.gradleProperty("tileflowVersion").orElse("0.0.0-local.1").get()

android {
    namespace = "dev.tileflow.routing"
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
    compilerOptions { optIn.add("dev.tileflow.configuration.internal.TileflowInternalApi") }
}

dependencies {
    api(project(":tileflow-configuration"))
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

val documentationJar by
    tasks.registering(Jar::class) {
        from(tasks.dokkaGeneratePublicationHtml.flatMap { it.outputDirectory })
        archiveClassifier.set("javadoc")
    }

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

afterEvaluate {
    publishing {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                artifactId = "tileflow-routing"
                artifact(documentationJar)
                pom {
                    name.set("Tileflow Routing for Android")
                    description.set(
                        "Routes, isochrones, matrices, map matching and nearest roads with Tileflow for Android."
                    )
                    url.set("https://github.com/tileflow/tileflow-sdk")
                    licenses {
                        license {
                            name.set("Apache License, Version 2.0")
                            url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
                        }
                    }
                    scm { url.set("https://github.com/tileflow/tileflow-sdk") }
                }
            }
        }
        repositories {
            maven {
                name = "candidate"
                url =
                    uri(
                        providers
                            .gradleProperty("tileflowRepository")
                            .orElse(
                                layout.buildDirectory.dir("repository").get().asFile.absolutePath
                            )
                            .get()
                    )
                require(url.scheme == "file") {
                    "Candidate packaging only writes to a local repository."
                }
            }
        }
    }
}
