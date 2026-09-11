package studio.sloom.slstapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;

public class SloomFontPackPluginTest {
    private static Method privateMethod(String name, Class<?>... parameters) throws Exception {
        Method method = SloomFontPackPlugin.class.getDeclaredMethod(name, parameters);
        method.setAccessible(true);
        return method;
    }

    @Test
    public void safePathAcceptsCatalogResourcesAndRejectsTraversal() throws Exception {
        Method requireSafePath = privateMethod("requireSafePath", String.class);
        assertEquals(
            "collection/base/example/Font[wght].ttf",
            requireSafePath.invoke(null, "collection/base/example/Font[wght].ttf")
        );
        for (String invalid : new String[] { "../secret", "/absolute", "a//b", "a/../../b", "a\\b", "" }) {
            try {
                requireSafePath.invoke(null, invalid);
                fail("Expected path rejection for: " + invalid);
            } catch (InvocationTargetException error) {
                assertTrue(error.getCause() instanceof IllegalArgumentException);
            }
        }
    }

    @Test
    public void canonicalResolutionCannotEscapeThePackRoot() throws Exception {
        Method resolveInside = privateMethod("resolveInside", File.class, String.class);
        File root = Files.createTempDirectory("sloom-font-pack-test").toFile();
        try {
            File nested = new File(root, "inventory/font-inventory.json");
            assertTrue(nested.getParentFile().mkdirs());
            assertTrue(nested.createNewFile());
            assertEquals(nested.getCanonicalFile(), resolveInside.invoke(null, root, "inventory/font-inventory.json"));
            try {
                resolveInside.invoke(null, root, "../outside");
                fail("Expected canonical root escape rejection");
            } catch (InvocationTargetException error) {
                assertTrue(error.getCause() instanceof IOException);
            }
        } finally {
            Files.walk(root.toPath())
                .sorted((left, right) -> right.compareTo(left))
                .forEach(path -> path.toFile().delete());
        }
    }
}
