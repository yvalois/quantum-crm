-- Provider-signed download references are encrypted before persistence and removed after intake.
ALTER TABLE conversations.inbound_media ADD COLUMN sealed_source text;
