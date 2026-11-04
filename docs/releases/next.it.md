# Prossima versione

## Da leggere prima di aggiornare

- **Segnalazioni agli sviluppatori:** ogni istanza dove nessun amministratore ha salvato una scelta inizia a poter inviare segnalazioni agli sviluppatori di Inkadra, anche se finora erano spente. Nessuna segnalazione parte senza che la persona la scriva, ne veda l'anteprima e la invii. Testo, screenshot, video, file e log selezionati lasciano il server e passano da Cloudflare, che vede l'IP del server. Per evitarlo, prima di aggiornare imposta `FEEDBACK_RELAY_URL=` vuota, poi salva una scelta in Impostazioni → Informazioni → Segnalazioni. Dettagli in `docs/self-hosting/configuration.md`.

## Per chi pubblica la versione

- Pubblica il Worker `inkadra-report-relay` prima dell'immagine (`relay/README.md`). Se l'ordine si inverte le segnalazioni aspettano in coda, senza perdersi.
