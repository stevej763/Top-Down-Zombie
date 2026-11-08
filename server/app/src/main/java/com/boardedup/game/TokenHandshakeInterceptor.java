package com.boardedup.game;

import com.boardedup.player.Player;
import com.boardedup.player.PlayerAuth;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

/** Resolves {@code /ws?token=...} to a player; unknown tokens get a 401 instead of a socket. */
final class TokenHandshakeInterceptor implements HandshakeInterceptor {
    static final String ACCOUNT = "account";
    static final String NAME = "name";

    private final PlayerAuth auth;

    TokenHandshakeInterceptor(PlayerAuth auth) {
        this.auth = auth;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
            Map<String, Object> attributes) {
        String token = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams().getFirst("token");
        Optional<Player> player = auth.find(token);
        if (player.isEmpty()) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put(ACCOUNT, player.get().getId());
        attributes.put(NAME, player.get().getName());
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Exception e) {}
}
