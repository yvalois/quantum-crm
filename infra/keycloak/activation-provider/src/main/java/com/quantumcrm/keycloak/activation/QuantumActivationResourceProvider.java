package com.quantumcrm.keycloak.activation;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.ext.Provider;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.keycloak.authentication.actiontoken.execactions.ExecuteActionsActionToken;
import org.keycloak.common.util.Time;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.representations.AccessToken;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.resource.RealmResourceProvider;

/**
 * The provider owns the one-use action-token metadata in Keycloak's single-use store.
 * No Quantum database, URL, password, business contract or public route is involved.
 */
@Provider
public final class QuantumActivationResourceProvider implements RealmResourceProvider {
  private static final int TTL_SECONDS = 30 * 60;
  private static final String PROVISIONER = "quantum-provisioner";
  private static final String BOOTSTRAP = "quantum-crm-bootstrap";
  private final KeycloakSession session;

  QuantumActivationResourceProvider(KeycloakSession session) { this.session = session; }
  @Override public Object getResource() { return this; }
  @Override public void close() { }

  @POST
  @Path("activation")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response issue(ActivationRequest request, @Context UriInfo uriInfo) {
    RealmModel serviceRealm = session.getContext().getRealm();
    if (request == null || !request.valid()) return typedStatus(404);
    boolean masterRequest = "master".equals(serviceRealm.getName())
      && authorized(serviceRealm, PROVISIONER)
      && request.administratorSubject != null;
    boolean memberRequest = request.invitationId != null
      && tenantRealm(request, serviceRealm)
      && authorized(serviceRealm, BOOTSTRAP);
    if (!masterRequest && !memberRequest) return typedStatus(404);
    RealmModel realm = masterRequest
      ? session.realms().getRealmByName("qcrm-" + request.tenantProfileId.replace("-", ""))
      : serviceRealm;
    if (realm == null || !realm.isEnabled()) return typedStatus(404);
    UserModel user = masterRequest
      ? session.users().getUserById(realm, request.administratorSubject)
      : findOrCreateMemberUser(realm, request);
    if (user == null || !user.isEnabled()) return typedStatus(404);
    ClientModel client = realm.getClientByClientId("quantum-crm-web");
    if (client == null) return typedStatus(409);

    String prior = "qcrm:activation:current:" + user.getId();
    Map<String, String> priorValue = session.singleUseObjects().get(prior);
    if (priorValue != null && priorValue.get("jti") != null) {
      /* This is the native Keycloak revocation fence. Execute-actions links are
       * validated against the user's not-before timestamp by the built-in token
       * handler, so a token issued before this instant is rejected even if an
       * old serialized URL is retained outside Quantum. Metadata deletion alone
       * would not invalidate the native action token. */
      session.users().setNotBeforeForUser(realm, user, Time.currentTime());
      session.singleUseObjects().remove("qcrm:activation:jti:" + priorValue.get("jti"));
    }
    int expiration = Time.currentTime() + TTL_SECONDS;
    // Keycloak signs and consumes the native execute-actions token. The extra entry lets
    // the provider invalidate a prior generation before issuing a replacement.
    ExecuteActionsActionToken token = new ExecuteActionsActionToken(
      user.getId(), expiration,
      List.of(
        UserModel.RequiredAction.UPDATE_PASSWORD.name(),
        UserModel.RequiredAction.CONFIGURE_TOTP.name(),
        QuantumActivationCompletionRequiredAction.ID),
      null, client.getClientId());
    // A distinct native action-token type binds processing to our handler. The
    // completion required action writes the consumption marker only after
    // Keycloak completes both the password and TOTP required actions.
    token.type(QuantumActivationActionTokenHandler.ID);
    // DefaultActionToken assigns its native token identifier during serialization.
    // Persisting metadata before this point would create a null JTI and make the
    // activation endpoint fail while hashing it.
    // TokenManager signs with the realm currently attached to the request
    // context. This endpoint is authenticated in master but issues a token for
    // the tenant realm, so select that realm only for signing and always restore
    // the service realm afterwards.
    String serialized;
    try {
      session.getContext().setRealm(realm);
      serialized = token.serialize(session, realm, uriInfo);
    } finally {
      session.getContext().setRealm(serviceRealm);
    }
    String jti = token.getId();
    if (jti == null) throw new IllegalStateException("Keycloak did not assign an action-token identifier");
    session.singleUseObjects().put(
      "qcrm:activation:jti:" + jti,
      TTL_SECONDS,
      issuedMetadata(request, jti));
    session.singleUseObjects().put(prior, TTL_SECONDS, Map.of("jti", jti));
    String link = uriInfo.getBaseUriBuilder().path("realms").path(realm.getName())
      .path("login-actions/action-token").queryParam("key", serialized).build().toString();
    return Response.ok(Map.of("url", link, "subject", user.getId(), "generation", request.generation,
      "expiresAt", Instant.now().plusSeconds(TTL_SECONDS).toString())).header("Cache-Control", "no-store").build();
  }

  /** This never returns an action token or relies on a browser acknowledgement. */
  @GET
  @Path("activation/status")
  @Produces(MediaType.APPLICATION_JSON)
  public Response status(
      @QueryParam("tenantProfileId") String tenantProfileId,
      @QueryParam("administratorSubject") String administratorSubject,
      @QueryParam("generation") int generation,
      @QueryParam("invitationId") String invitationId) {
    ActivationRequest request = new ActivationRequest();
    request.tenantProfileId = tenantProfileId;
    request.administratorSubject = administratorSubject;
    request.generation = generation;
    request.invitationId = invitationId;
    RealmModel serviceRealm = session.getContext().getRealm();
    if (!"master".equals(serviceRealm.getName()) || !authorized(serviceRealm, PROVISIONER)
        || !request.valid() || request.administratorSubject == null) return typedStatus(404);
    RealmModel realm = session.realms().getRealmByName("qcrm-" + request.tenantProfileId.replace("-", ""));
    if (realm == null || !realm.isEnabled()) return typedStatus(404);
    UserModel user = session.users().getUserById(realm, request.administratorSubject);
    if (user == null || !user.isEnabled()) return typedStatus(404);
    Map<String, String> current = session.singleUseObjects().get("qcrm:activation:current:" + user.getId());
    if (current == null || current.get("jti") == null) return typedStatus(409);
    Map<String, String> token = session.singleUseObjects().get("qcrm:activation:jti:" + current.get("jti"));
    if (token == null
      || !Integer.toString(request.generation).equals(token.get("generation"))
      || !sameInvitation(token, request.invitationId)) return typedStatus(409);
    boolean consumed = "consumed".equals(token.get("status"))
      && sha256(current.get("jti")).equals(token.get("jtiHash"));
    Map<String, Object> response = new HashMap<>();
    response.put("generation", request.generation);
    response.put("status", consumed ? "consumed" : "pending");
    if (request.invitationId != null) response.put("invitationId", request.invitationId);
    return Response.ok(response)
      .header("Cache-Control", "no-store").build();
  }

  private static Map<String, String> issuedMetadata(ActivationRequest request, String jti) {
    Map<String, String> metadata = new HashMap<>();
    metadata.put("generation", Integer.toString(request.generation));
    metadata.put("status", "issued");
    metadata.put("jtiHash", sha256(jti));
    if (request.invitationId != null) metadata.put("invitationId", request.invitationId);
    return metadata;
  }

  private static boolean sameInvitation(Map<String, String> token, String invitationId) {
    String issuedInvitationId = token.get("invitationId");
    return invitationId == null ? issuedInvitationId == null : invitationId.equals(issuedInvitationId);
  }

  private static Response typedStatus(int status) {
    return Response.status(status).type(MediaType.APPLICATION_JSON_TYPE).build();
  }

  private boolean tenantRealm(ActivationRequest request, RealmModel realm) {
    return realm.getName().equals("qcrm-" + request.tenantProfileId.replace("-", ""));
  }

  private UserModel findOrCreateMemberUser(RealmModel realm, ActivationRequest request) {
    UserModel user = session.users().getUserByEmail(realm, request.email);
    if (user == null) {
      user = session.users().addUser(realm, request.email);
    } else {
      Map<String, String> current = session.singleUseObjects()
        .get("qcrm:activation:current:" + user.getId());
      if (current == null || current.get("jti") == null) {
        if (user.isEnabled() && user.getRequiredActionsStream().noneMatch(action ->
            UserModel.RequiredAction.UPDATE_PASSWORD.name().equals(action)
              || UserModel.RequiredAction.CONFIGURE_TOTP.name().equals(action)
              || QuantumActivationCompletionRequiredAction.ID.equals(action))) {
          return null;
        }
      } else {
        Map<String, String> issued = session.singleUseObjects()
          .get("qcrm:activation:jti:" + current.get("jti"));
        if (issued == null || !request.invitationId.equals(issued.get("invitationId"))
            || !Integer.toString(request.generation).equals(issued.get("generation"))) {
          return null;
        }
      }
    }
    if (user == null) return null;
    user.setUsername(request.email);
    user.setEmail(request.email);
    user.setFirstName(request.displayName);
    user.setEnabled(true);
    user.setEmailVerified(false);
    user.addRequiredAction(UserModel.RequiredAction.UPDATE_PASSWORD.name());
    user.addRequiredAction(UserModel.RequiredAction.CONFIGURE_TOTP.name());
    user.addRequiredAction(QuantumActivationCompletionRequiredAction.ID);
    return user;
  }

  private boolean authorized(RealmModel realm, String expectedClient) {
    AppAuthManager.AuthResult result = new AppAuthManager.BearerTokenAuthenticator(session)
      .setRealm(realm).authenticate();
    if (result == null) return false;
    AccessToken token = result.getToken();
    return expectedClient.equals(token.getIssuedFor()) && result.getClient() != null
      && expectedClient.equals(result.getClient().getClientId());
  }
  private static String sha256(String value) {
    try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
  }

  public static final class ActivationRequest {
    public String tenantProfileId;
    public String administratorSubject;
    public String email;
    public String displayName;
    public int generation;
    /** Optional for the initial administrator; mandatory for a CRM member invite. */
    public String invitationId;
    public boolean valid() {
      boolean administrator = administratorSubject != null && administratorSubject.matches("^[!-~]{1,255}$");
      boolean member = invitationId != null
        && email != null && email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
        && displayName != null && displayName.trim().length() >= 1 && displayName.length() <= 160;
      return tenantProfileId != null && tenantProfileId.matches("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        && (administrator || member)
        && (invitationId == null || invitationId.matches("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"))
        && generation > 0;
    }
  }
}
