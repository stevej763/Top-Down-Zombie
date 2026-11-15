package com.topdownsurvival.mail;

import java.util.Properties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;

/**
 * SMTP when {@code MAIL_HOST} is set, otherwise a mailer that only logs (dev and tests). The
 * settings are our own rather than {@code spring.mail.*} so Boot doesn't build a sender with an
 * empty host, or try to log in with an empty username.
 */
@Configuration
class MailConfig {
    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);
    private static final String TIMEOUT_MS = "10000";

    @Bean
    Mailer mailer(@Value("${top-down-survival.mail.host:}") String host,
            @Value("${top-down-survival.mail.port:587}") int port,
            @Value("${top-down-survival.mail.username:}") String username,
            @Value("${top-down-survival.mail.password:}") String password,
            @Value("${top-down-survival.mail.from:Top Down Survival <noreply@localhost>}") String from) {
        if (host.isBlank()) {
            log.warn("MAIL_HOST is not set: emails are written to the log instead of sent");
            return (to, subject, body) -> log.info("Email to {}: {}\n{}", to, subject, body);
        }
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(port);
        Properties props = sender.getJavaMailProperties();
        if (!username.isBlank()) {
            sender.setUsername(username);
            sender.setPassword(password);
            props.put("mail.smtp.auth", "true");
        }
        // Upgrades to TLS when the server offers it (providers do; Mailpit in dev doesn't).
        props.put("mail.smtp.starttls.enable", "true");
        // 465 is TLS from the first byte rather than STARTTLS.
        if (port == 465) props.put("mail.smtp.ssl.enable", "true");
        props.put("mail.smtp.connectiontimeout", TIMEOUT_MS);
        props.put("mail.smtp.timeout", TIMEOUT_MS);
        props.put("mail.smtp.writetimeout", TIMEOUT_MS);
        return (to, subject, body) -> {
            SimpleMailMessage m = new SimpleMailMessage();
            m.setFrom(from);
            m.setTo(to);
            m.setSubject(subject);
            m.setText(body);
            sender.send(m);
        };
    }
}
