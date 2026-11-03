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

rootProject.name = "TileflowReactNativeUnitTests"

// The Tileflow Android SDK from this repository, in place of its published artifacts.
includeBuild("../../platforms/android") {
    dependencySubstitution {
        substitute(module("dev.tileflow:tileflow-sdk")).using(project(":tileflow"))
        for (name in listOf("configuration", "search", "routing", "elevation", "geoip")) {
            substitute(module("dev.tileflow:tileflow-$name")).using(project(":tileflow-$name"))
        }
    }
}
