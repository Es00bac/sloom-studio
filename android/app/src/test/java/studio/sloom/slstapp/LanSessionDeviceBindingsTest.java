package studio.sloom.slstapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LanSessionDeviceBindingsTest {
    @Test
    public void bindsReconnectAndReplaySessionsToTheRegisteredPeerOnly() {
        LanSessionDeviceBindings bindings = new LanSessionDeviceBindings();

        assertTrue(bindings.bind("session-one", "peer-a", "proof-a"));
        assertEquals("peer-a", bindings.deviceForToken("session-one"));

        // A reconnect receives a new bearer but preserves the same registered device identity.
        assertTrue(bindings.bind("session-two", "peer-a", "proof-a"));
        assertEquals("peer-a", bindings.deviceForToken("session-two"));
        // Replaying the old bearer cannot turn it into another principal.
        assertEquals("peer-a", bindings.deviceForToken("session-one"));
    }

    @Test
    public void refusesHostAndOtherMemberImpersonationBeforeASecondSessionIsBound() {
        LanSessionDeviceBindings bindings = new LanSessionDeviceBindings();
        assertTrue(bindings.bind("member-session", "member-a", "member-proof"));

        assertFalse(bindings.bind("host-claim", LanSessionDeviceBindings.HOST_DEVICE_ID, "attacker-proof"));
        assertFalse(bindings.bind("member-claim", "member-a", "attacker-proof"));
        assertNull(bindings.deviceForToken("host-claim"));
        assertNull(bindings.deviceForToken("member-claim"));
        assertEquals("member-a", bindings.deviceForToken("member-session"));
    }

    @Test
    public void rotationCreatesANewBoundPrincipalWithoutRewritingExistingSessions() {
        LanSessionDeviceBindings bindings = new LanSessionDeviceBindings();
        assertTrue(bindings.bind("old-session", "peer-before-rotation", "old-proof"));
        assertTrue(bindings.bind("rotated-session", "peer-after-rotation", "new-proof"));

        assertEquals("peer-before-rotation", bindings.deviceForToken("old-session"));
        assertEquals("peer-after-rotation", bindings.deviceForToken("rotated-session"));
        assertFalse(bindings.bind("take-old", "peer-before-rotation", "new-proof"));
    }
}
