package com.topdownsurvival.game;

import com.topdownsurvival.admin.AdminAuth;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * {@code /ws/watch?code=ABCD}: admins only, by their session cookie (sent because the portal proxies
 * this same-origin). Registered without extra allowed origins, so another site can't open it with
 * an admin's cookie.
 */
final class WatchHandshakeInterceptor implements HandshakeInterceptor {
    static final String ROOM = "watching";

    private final AdminAuth auth;

    WatchHandshakeInterceptor(AdminAuth auth) {
        this.auth = auth;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
            Map<String, Object> attributes) {
        HttpServletRequest servlet = request instanceof ServletServerHttpRequest s ? s.getServletRequest() : null;
        if (servlet == null || auth.find(AdminAuth.cookie(servlet)).isEmpty()) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        String code = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams().getFirst("code");
        if (code == null || code.isBlank()) {
            response.setStatusCode(HttpStatus.BAD_REQUEST);
            return false;
        }
        attributes.put(ROOM, code.trim().toUpperCase(Locale.ROOT));
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Exception e) {}
}
