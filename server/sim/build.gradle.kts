// The game simulation: plain Java, no Spring.
plugins {
    `java-library`
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(25) }
}

repositories { mavenCentral() }

dependencies {
    // Only for versions; the sim doesn't use Spring.
    api(platform("org.springframework.boot:spring-boot-dependencies:4.1.2"))
    api("tools.jackson.core:jackson-databind")

    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.junit.jupiter:junit-jupiter-params")
    testImplementation("org.assertj:assertj-core")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// Gameplay tuning shared with the client.
tasks.processResources {
    from(rootDir.resolve("../shared/defs")) { into("defs") }
}

// The repo's maps, for tests.
tasks.processTestResources {
    from(rootDir.resolve("../maps")) { into("maps") }
}

tasks.test { useJUnitPlatform() }
