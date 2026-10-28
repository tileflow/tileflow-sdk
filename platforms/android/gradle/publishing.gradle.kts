// Maven publication shared by every published Tileflow Android library.
//
// A library applies this script after its Android, Kotlin and Dokka plugins. Coordinates, names
// and descriptions come from `platforms/native-release.json`, which the release scripts read too.
// Builds only ever write to a local `file:` repository; signing and upload to Maven Central happen
// later, on the exact files this produces (see PUBLISHING.md).
import groovy.json.JsonSlurper

apply(plugin = "maven-publish")

val catalogFile = rootProject.layout.projectDirectory.file("../native-release.json")
val catalog = JsonSlurper().parseText(providers.fileContents(catalogFile).asText.get()) as Map<*, *>
val projectInfo = catalog["project"] as Map<*, *>
val license = projectInfo["license"] as Map<*, *>
val maven = catalog["maven"] as Map<*, *>
val entry =
    (maven["publications"] as List<*>).map { it as Map<*, *> }.singleOrNull {
        it["module"] == project.name
    } ?: error("platforms/native-release.json does not publish :${project.name}.")
val sourceUrl = projectInfo["url"] as String
val sourceRepository = catalog["sourceRepository"] as String

group = maven["group"] as String

version = providers.gradleProperty("tileflowVersion").orElse("0.0.0-local.1").get()

// Records the exact source commit in the POM when the release scripts provide it.
val sourceRevision = providers.gradleProperty("tileflowSourceRevision")

val documentationJar =
    tasks.register<Jar>("documentationJar") {
        from(tasks.named("dokkaGeneratePublicationHtml"))
        archiveClassifier.set("javadoc")
    }

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

afterEvaluate {
    configure<PublishingExtension> {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                artifactId = entry["artifactId"] as String
                artifact(documentationJar)
                pom {
                    name.set(entry["name"] as String)
                    description.set(entry["description"] as String)
                    url.set(sourceUrl)
                    licenses {
                        license {
                            name.set(license["name"] as String)
                            url.set(license["url"] as String)
                            distribution.set("repo")
                        }
                    }
                    organization {
                        name.set(projectInfo["name"] as String)
                        url.set(projectInfo["organizationUrl"] as String)
                    }
                    developers {
                        developer {
                            id.set("tileflow")
                            name.set(projectInfo["name"] as String)
                            organization.set(projectInfo["name"] as String)
                            organizationUrl.set(projectInfo["organizationUrl"] as String)
                        }
                    }
                    scm {
                        url.set(sourceUrl)
                        connection.set("scm:git:https://github.com/$sourceRepository.git")
                        developerConnection.set("scm:git:ssh://git@github.com/$sourceRepository.git")
                        if (sourceRevision.isPresent) tag.set(sourceRevision.get())
                    }
                    issueManagement {
                        system.set("GitHub Issues")
                        url.set("$sourceUrl/issues")
                    }
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
