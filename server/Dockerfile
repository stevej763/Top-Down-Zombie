# Built from the repo root (see docker-compose.yml) because the jar bundles ../maps and ../shared/defs.

# --- Build stage: compile and package the Spring Boot jar ---
FROM gradle:9-jdk25 AS build
WORKDIR /src
COPY server server
COPY maps maps
COPY shared shared
WORKDIR /src/server
RUN ./gradlew :app:bootJar --no-daemon -q

# --- Runtime stage ---
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=build /src/server/app/build/libs/*.jar app.jar
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/actuator/health >/dev/null || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
