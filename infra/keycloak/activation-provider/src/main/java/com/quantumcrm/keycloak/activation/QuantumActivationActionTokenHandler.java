package com.quantumcrm.keycloak.activation;

import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.keycloak.authentication.actiontoken.ActionTokenContext;
import org.keycloak.authentication.actiontoken.execactions.ExecuteActionsActionToken;
import org.keycloak.authentication.actiontoken.execactions.ExecuteActionsActionTokenHandler;

/**
 * Handles only Quantum's distinct execute-actions token type.  The built-in
 * execute-actions behavior remains intact, while this provider records a
 * current-generation authentication-session marker after the native handler
 * accepts the signed one-use token. Consumption is deliberately deferred to
 * the final required action, after password and TOTP have both succeeded.
 */
public final class QuantumActivationActionTokenHandler extends ExecuteActionsActionTokenHandler {
  public static final String ID = "qcrm-activation";

  @Override public String getId() { return ID; }

  @Override
  public Response handleToken(
      ExecuteActionsActionToken token,
      ActionTokenContext<ExecuteActionsActionToken> context) {
    Response response = super.handleToken(token, context);
    if (response.getStatusInfo().getFamily() == Response.Status.Family.REDIRECTION) {
      String currentKey = "qcrm:activation:current:" + token.getUserId();
      Map<String, String> current = context.getSession().singleUseObjects().get(currentKey);
      if (current != null && token.getId() != null && token.getId().equals(current.get("jti"))) {
        Map<String, String> issued = context.getSession().singleUseObjects()
          .get("qcrm:activation:jti:" + token.getId());
        if (issued != null
            && "issued".equals(issued.get("status"))) {
          context.getAuthenticationSession().setAuthNote(
            QuantumActivationCompletionRequiredAction.AUTH_NOTE_JTI,
            token.getId());
        }
      }
    }
    return response;
  }
}
