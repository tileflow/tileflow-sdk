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

include(":tileflow-configuration")

include(":tileflow-search")

include(":tileflow-routing")

include(":tileflow-elevation")

include(":tileflow-geoip")

include(":tileflow-service-content")

include(":example")
