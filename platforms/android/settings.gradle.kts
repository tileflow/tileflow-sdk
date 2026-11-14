pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Tileflow"

include(":tileflow")

include(":tileflow-foundation")

include(":tileflow-services")

include(":example")

if (providers.gradleProperty("tileflowBenchmark").isPresent) include(":benchmark")

if (providers.gradleProperty("tileflowTreeProof").isPresent) include(":tree-proof")
