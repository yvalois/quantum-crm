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
public final class QuantumActivationResourceProvider implements RealmResourceProvider {
  private static final int TTL_SECONDS = 30 * 60;
  private static final String PROVISIONER = "quantum-provisioner";
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
    if (!"master".equals(serviceRealm.getName()) || !authorized(serviceRealm, uriInfo) || request == null || !request.valid()) return Response.status(404).build();
    RealmModel realm = session.realms().getRealmByName("qcrm-" + request.tenantProfileId.replace("-", ""));
    if (realm == null || !realm.isEnabled()) return Response.status(404).build();
    UserModel user = session.users().getUserById(realm, request.administratorSubject);
    if (user == null || !user.isEnabled()) return Response.status(404).build();
    ClientModel client = realm.getClientByClientId("quantum-crm-web");
    if (client == null) return Response.status(409).build();

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
    // A distinct native action-token type binds processing to our handler.  The
    // The completion required action writes the consumption marker only after
    // Keycloak completes both the password and TOTP required actions.
    token.type(QuantumActivationActionTokenHandler.ID);
    String jti = token.getId();
    session.singleUseObjects().put(
      "qcrm:activation:jti:" + jti,
      TTL_SECONDS,
      issuedMetadata(request, jti));
    session.singleUseObjects().put(prior, TTL_SECONDS, Map.of("jti", jti));
    String serialized = token.serialize(session, realm, uriInfo);
    String link = uriInfo.getBaseUriBuilder().path("realms").path(realm.getName())
      .path("login-actions/action-token").queryParam("key", serialized).build().toString();
    return Response.ok(Map.of("url", link, "generation", request.generation,
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
      @QueryParam("invitationId") String invitationId,
      @Context UriInfo uriInfo) {
    ActivationRequest request = new ActivationRequest();
    request.tenantProfileId = tenantProfileId;
    request.administratorSubject = administratorSubject;
    request.generation = generation;
    request.invitationId = invitationId;
    RealmModel serviceRealm = session.getContext().getRealm();
    if (!"master".equals(serviceRealm.getName()) || !authorized(serviceRealm, uriInfo) || !request.valid()) return Response.status(404).build();
    RealmModel realm = session.realms().getRealmByName("qcrm-" + request.tenantProfileId.replace("-", ""));
    if (realm == null || !realm.isEnabled()) return Response.status(404).build();
    UserModel user = session.users().getUserById(realm, request.administratorSubject);
    if (user == null || !user.isEnabled()) return Response.status(404).build();
    Map<String, String> current = session.singleUseObjects().get("qcrm:activation:current:" + user.getId());
    if (current == null || current.get("jti") == null) return Response.status(409).build();
    Map<String, String> token = session.singleUseObjects().get("qcrm:activation:jti:" + current.get("jti"));
    if (token == null
      || !Integer.toString(request.generation).equals(token.get("generation"))
      || !sameInvitation(token, request.invitationId)) return Response.status(409).build();
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

  private boolean authorized(RealmModel realm, UriInfo uriInfo) {
    AppAuthManager.AuthResult result = new AppAuthManager.BearerTokenAuthenticator(session)
      .setRealm(realm).setUriInfo(uriInfo).authenticate();
    if (result == null) return false;
    AccessToken token = result.getToken();
    return PROVISIONER.equals(token.getIssuedFor()) && result.getClient() != null
      && PROVISIONER.equals(result.getClient().getClientId());
  }
  private static String sha256(String value) {
    try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
  }

  public static final class ActivationRequest {
    public String tenantProfileId;
    public String administratorSubject;
    public int generation;
    /** Optional for the initial administrator; mandatory for a CRM member invite. */
    public String invitationId;
    public boolean valid() {
      return tenantProfileId != null && tenantProfileId.matches("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        && administratorSubject != null && administratorSubject.matches("^[!-~]{1,255}$")
        && (invitationId == null || invitationId.matches("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"))
        && generation > 0;
    }
  }
}
