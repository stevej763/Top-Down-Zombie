package com.topdownsurvival.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final String[] corsOrigins;

    public WebConfig(@Value("${top-down-survival.cors-origins}") String[] corsOrigins) {
        this.corsOrigins = corsOrigins;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(corsOrigins)
                .allowedMethods("GET", "POST", "PATCH")
                .allowedHeaders("Authorization", "Content-Type");
    }
}
