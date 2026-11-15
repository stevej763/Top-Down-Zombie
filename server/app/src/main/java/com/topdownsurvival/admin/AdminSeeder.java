package com.topdownsurvival.admin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD while there are none. */
@Component
public class AdminSeeder implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final AdminAuth auth;
    private final String username;
    private final String password;

    public AdminSeeder(AdminAuth auth, @Value("${top-down-survival.admin.username:}") String username,
            @Value("${top-down-survival.admin.password:}") String password) {
        this.auth = auth;
        this.username = username;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (auth.count() > 0) return;
        if (username.isBlank() || password.isEmpty()) {
            log.warn("No admin accounts: set ADMIN_USERNAME and ADMIN_PASSWORD to create the first one");
            return;
        }
        auth.insert(username, password);
        log.info("Created admin account '{}'", AdminAuth.normalize(username));
    }
}
