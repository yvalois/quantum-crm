package com.quantumcrm.keycloak.activation;

import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.resource.RealmResourceProvider;
import org.keycloak.services.resource.RealmResourceProviderFactory;

/** Private, server-side resource. It is never routed by the public Caddy host. */
public final class QuantumActivationResourceProviderFactory implements RealmResourceProviderFactory {
  public static final String ID = "qcrm-internal";

  @Override public RealmResourceProvider create(KeycloakSession session) {
    return new QuantumActivationResourceProvider(session);
  }
  @Override public void init(Config.Scope config) { }
  @Override public void postInit(KeycloakSessionFactory factory) { }
  @Override public void close() { }
  @Override public String getId() { return ID; }
  @Override public java.util.List<ProviderConfigProperty> getConfigMetadata() { return java.util.List.of(); }
}
