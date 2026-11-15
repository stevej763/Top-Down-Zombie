package com.topdownsurvival.mail;

/** Sends plain-text email. Blocking: callers send off the request thread. */
public interface Mailer {
    void send(String to, String subject, String body);
}
