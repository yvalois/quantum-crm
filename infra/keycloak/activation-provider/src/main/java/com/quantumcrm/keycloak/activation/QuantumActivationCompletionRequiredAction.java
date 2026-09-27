package com.quantumcrm.keycloak.activation;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import org.keycloak.Config;
import org.keycloak.authentication.RequiredActionContext;
import org.keycloak.authentication.RequiredActionFactory;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.UserModel;

/**
 * Final, non-interactive activation action. It can only complete an auth
 * session that the signed Quantum activation token opened, and only after the
 * administrator's persistent password and TOTP actions have been removed by
 * Keycloak's native successful flows.
 */
public final class QuantumActivationCompletionRequiredAction
    implements RequiredActionProvider, RequiredActionFactory {
  public static final String ID = "QCRM_ACTIVATION_COMPLETE";
  public static final String AUTH_NOTE_JTI = "qcrm.activation.jti";

  @Override public void evaluateTriggers(RequiredActionContext context) { }

  @Override
  public void requiredActionChallenge(RequiredActionContext context) {
    if (!canComplete(context)) {
      context.failure();
      return;
    }
    String jti = context.getAuthenticationSession().getAuthNote(AUTH_NOTE_JTI);
    Map<String, String> issued = context.getSession().singleUseObjects()
      .get("qcrm:activation:jti:" + jti);
    // The single-use entry TTL is authoritative. Replacing only its status
    // preserves its original expiry while making status polling monotonic.
    if (!context.getSession().singleUseObjects().replace(
      "qcrm:activation:jti:" + jti,
      Map.of(
        "generation", issued.get("generation"),
        "status", "consumed",
        "jtiHash", issued.get("jtiHash")))) {
      context.failure();
      return;
    }
    context.getAuthenticationSession().removeAuthNote(AUTH_NOTE_JTI);
    context.success();
  }

  @Override
  public void processAction(RequiredActionContext context) {
    requiredActionChallenge(context);
  }

  private boolean canComplete(RequiredActionContext context) {
    String jti = context.getAuthenticationSession().getAuthNote(AUTH_NOTE_JTI);
    if (jti == null || jti.length() < 1) return false;
    Map<String, String> current = context.getSession().singleUseObjects()
      .get("qcrm:activation:current:" + context.getUser().getId());
    Map<String, String> issued = context.getSession().singleUseObjects()
      .get("qcrm:activation:jti:" + jti);
    return current != null
      && jti.equals(current.get("jti"))
      && issued != null
      && "issued".equals(issued.get("status"))
      && sha256(jti).equals(issued.get("jtiHash"))
      && context.getUser().getRequiredActionsStream().noneMatch(action ->
        UserModel.RequiredAction.UPDATE_PASSWORD.name().equals(action)
          || UserModel.RequiredAction.CONFIGURE_TOTP.name().equals(action));
  }

  private static String sha256(String value) {
    try {
      return java.util.HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException(error);
    }
  }

  @Override public RequiredActionProvider create(KeycloakSession session) {
    return new QuantumActivationCompletionRequiredAction();
  }
  @Override public void init(Config.Scope config) { }
  @Override public void postInit(KeycloakSessionFactory factory) { }
  @Override public void close() { }
  @Override public String getId() { return ID; }
  @Override public String getDisplayText() { return "Complete Quantum activation"; }
}
