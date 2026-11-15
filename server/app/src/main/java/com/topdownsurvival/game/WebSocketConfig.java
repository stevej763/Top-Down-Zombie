package com.topdownsurvival.game;

import com.topdownsurvival.admin.AdminAuth;
import com.topdownsurvival.player.PlayerAuth;
import java.time.InstantSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    private final GameSocketHandler handler;
    private final PlayerAuth auth;
    private final AdminAuth admins;
    private final String[] corsOrigins;

    public WebSocketConfig(GameSocketHandler handler, PlayerAuth auth, AdminAuth admins,
            @Value("${top-down-survival.cors-origins}") String[] corsOrigins) {
        this.handler = handler;
        this.auth = auth;
        this.admins = admins;
        this.corsOrigins = corsOrigins;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Same-origin requests (through nginx or the Vite proxy) are always allowed; these are extra.
        registry.addHandler(handler, "/ws").addInterceptors(new TokenHandshakeInterceptor(auth)).setAllowedOrigins(corsOrigins);
        // Same-origin only: it's authenticated by a cookie, which a browser would attach for any site.
        registry.addHandler(handler, "/ws/watch").addInterceptors(new WatchHandshakeInterceptor(admins));
    }

    /** Static: the handler this config needs depends on it, so it can't wait for this config to exist. */
    @Bean
    static InstantSource clock() {
        return InstantSource.system();
    }
}
