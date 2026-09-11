package studio.sloom.slstapp;

import android.app.Activity;
import android.net.Uri;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingProgramReportingDetails;
import com.android.billingclient.api.BillingProgramReportingDetailsParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.LaunchExternalLinkParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Narrow Google Play commerce bridge used by the public Android build.
 *
 * The permanent entitlement is still the cross-platform, offline-verifiable Sloom key. Play owns
 * payment; the renderer sends the resulting purchase token to the Sloom fulfillment endpoint,
 * which verifies/acknowledges it and returns the same key used by desktop builds. The token never
 * enters project data or persisted settings.
 */
@CapacitorPlugin(name = "SloomPlayCommerce")
public final class SloomPlayCommercePlugin extends Plugin {
    private static final String COMMERCIAL_LICENSE_PRODUCT_ID = "commercial_license";
    private static final Uri DIRECT_PURCHASE_URI = Uri.parse("https://sloom.studio/#license");

    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;
    private final List<PendingBillingAction> pendingBillingActions = new ArrayList<>();
    private boolean connecting;

    private interface BillingReadyAction {
        void run();
    }

    private interface ProductDetailsCallback {
        void run(ProductDetails productDetails);
    }

    private static final class PendingBillingAction {
        final PluginCall call;
        final BillingReadyAction action;

        PendingBillingAction(PluginCall call, BillingReadyAction action) {
            this.call = call;
            this.action = action;
        }
    }

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .enableBillingProgram(BillingClient.BillingProgram.EXTERNAL_CONTENT_LINK)
            .build();
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (this) {
            if (pendingPurchaseCall != null) {
                pendingPurchaseCall.reject(
                    "The purchase flow closed before it completed.",
                    "ACTIVITY_DESTROYED"
                );
                pendingPurchaseCall = null;
            }
            for (PendingBillingAction pending : pendingBillingActions) {
                pending.call.reject(
                    "Google Play Billing closed before it connected.",
                    "ACTIVITY_DESTROYED"
                );
            }
            pendingBillingActions.clear();
            connecting = false;
        }
        if (billingClient != null) {
            billingClient.endConnection();
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getExternalContentLinkAvailability(PluginCall call) {
        withBillingReady(call, () -> billingClient.isBillingProgramAvailableAsync(
            BillingClient.BillingProgram.EXTERNAL_CONTENT_LINK,
            (result, ignoredDetails) -> {
                JSObject payload = billingResultPayload(result);
                payload.put("available", isOk(result));
                call.resolve(payload);
            }
        ));
    }

    @PluginMethod
    public void openDirectPurchase(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The Android activity is unavailable.", "ACTIVITY_UNAVAILABLE");
            return;
        }

        withBillingReady(call, () -> billingClient.isBillingProgramAvailableAsync(
            BillingClient.BillingProgram.EXTERNAL_CONTENT_LINK,
            (result, ignoredDetails) -> prepareDirectPurchase(call, activity, result)
        ));
    }

    private void prepareDirectPurchase(PluginCall call, Activity activity, BillingResult result) {
        if (!isOk(result)) {
            rejectBilling(call, "External purchasing is not available for this user.", result);
            return;
        }

        billingClient.createBillingProgramReportingDetailsAsync(
            BillingProgramReportingDetailsParams.newBuilder()
                .setBillingProgram(BillingClient.BillingProgram.EXTERNAL_CONTENT_LINK)
                .build(),
            (reportingResult, details) -> launchDirectPurchase(
                activity,
                call,
                reportingResult,
                details
            )
        );
    }

    private void launchDirectPurchase(
        Activity activity,
        PluginCall call,
        BillingResult result,
        BillingProgramReportingDetails details
    ) {
        if (!isOk(result) || details == null) {
            rejectBilling(call, "Google Play could not prepare the external purchase link.", result);
            return;
        }

        billingClient.launchExternalLink(
            activity,
            LaunchExternalLinkParams.newBuilder()
                .setBillingProgram(BillingClient.BillingProgram.EXTERNAL_CONTENT_LINK)
                .setExternalTransactionToken(details.getExternalTransactionToken())
                .setLinkUri(DIRECT_PURCHASE_URI)
                .setLinkType(LaunchExternalLinkParams.LinkType.LINK_TO_DIGITAL_CONTENT_OFFER)
                .setLaunchMode(LaunchExternalLinkParams.LaunchMode.LAUNCH_IN_EXTERNAL_BROWSER_OR_APP)
                .build(),
            launchResult -> {
                if (!isOk(launchResult)) {
                    rejectBilling(call, "Google Play did not open the direct purchase link.", launchResult);
                    return;
                }
                JSObject payload = billingResultPayload(launchResult);
                payload.put("launched", true);
                call.resolve(payload);
            }
        );
    }

    @PluginMethod
    public void getPlayProduct(PluginCall call) {
        withBillingReady(call, () -> queryCommercialLicenseProduct(call, productDetails -> {
            ProductDetails.OneTimePurchaseOfferDetails offer = selectOffer(productDetails);
            JSObject payload = new JSObject();
            payload.put("available", true);
            payload.put("productId", productDetails.getProductId());
            payload.put("name", productDetails.getName());
            payload.put("description", productDetails.getDescription());
            payload.put("formattedPrice", offer == null ? "" : offer.getFormattedPrice());
            call.resolve(payload);
        }));
    }

    @PluginMethod
    public void purchaseCommercialLicense(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The Android activity is unavailable.", "ACTIVITY_UNAVAILABLE");
            return;
        }
        synchronized (this) {
            if (pendingPurchaseCall != null) {
                call.reject("A Google Play purchase is already in progress.", "PURCHASE_IN_PROGRESS");
                return;
            }
        }

        withBillingReady(call, () -> queryCommercialLicenseProduct(call, productDetails -> {
            BillingFlowParams.ProductDetailsParams.Builder productParams =
                BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(productDetails);
            ProductDetails.OneTimePurchaseOfferDetails offer = selectOffer(productDetails);
            if (offer != null && offer.getOfferToken() != null && !offer.getOfferToken().isEmpty()) {
                productParams.setOfferToken(offer.getOfferToken());
            }
            BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(productParams.build()))
                .build();
            synchronized (this) {
                pendingPurchaseCall = call;
            }
            BillingResult result = billingClient.launchBillingFlow(activity, params);
            if (!isOk(result)) {
                synchronized (this) {
                    pendingPurchaseCall = null;
                }
                rejectBilling(call, "Google Play could not start the purchase.", result);
            }
        }));
    }

    @PluginMethod
    public void restoreCommercialLicensePurchase(PluginCall call) {
        withBillingReady(call, () -> billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
            (result, purchases) -> {
                if (!isOk(result)) {
                    rejectBilling(call, "Google Play could not restore purchases.", result);
                    return;
                }
                Purchase purchase = findCommercialLicensePurchase(purchases);
                if (purchase == null) {
                    JSObject payload = new JSObject();
                    payload.put("found", false);
                    call.resolve(payload);
                    return;
                }
                JSObject payload = purchasePayload(purchase);
                payload.put("found", true);
                call.resolve(payload);
            }
        ));
    }

    private void queryCommercialLicenseProduct(PluginCall call, ProductDetailsCallback callback) {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(COMMERCIAL_LICENSE_PRODUCT_ID)
            .setProductType(BillingClient.ProductType.INAPP)
            .build();
        billingClient.queryProductDetailsAsync(
            QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build(),
            (result, detailsResult) -> {
                if (!isOk(result)) {
                    rejectBilling(call, "Google Play could not load the commercial-license product.", result);
                    return;
                }
                List<ProductDetails> products = detailsResult.getProductDetailsList();
                if (products == null || products.isEmpty()) {
                    call.reject(
                        "The Google Play commercial-license product is not available yet.",
                        "PRODUCT_UNAVAILABLE"
                    );
                    return;
                }
                callback.run(products.get(0));
            }
        );
    }

    private ProductDetails.OneTimePurchaseOfferDetails selectOffer(ProductDetails productDetails) {
        List<ProductDetails.OneTimePurchaseOfferDetails> offers =
            productDetails.getOneTimePurchaseOfferDetailsList();
        if (offers != null && !offers.isEmpty()) {
            return offers.get(0);
        }
        return productDetails.getOneTimePurchaseOfferDetails();
    }

    private void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        PluginCall call;
        synchronized (this) {
            call = pendingPurchaseCall;
            pendingPurchaseCall = null;
        }
        if (call == null) {
            return;
        }
        if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            JSObject payload = billingResultPayload(result);
            payload.put("purchased", false);
            payload.put("cancelled", true);
            call.resolve(payload);
            return;
        }
        if (!isOk(result)) {
            rejectBilling(call, "The Google Play purchase did not complete.", result);
            return;
        }
        Purchase purchase = findCommercialLicensePurchase(purchases);
        if (purchase == null) {
            call.reject("Google Play returned no commercial-license purchase.", "PURCHASE_MISSING");
            return;
        }
        JSObject payload = purchasePayload(purchase);
        payload.put("purchased", purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED);
        payload.put("pending", purchase.getPurchaseState() == Purchase.PurchaseState.PENDING);
        call.resolve(payload);
    }

    private Purchase findCommercialLicensePurchase(List<Purchase> purchases) {
        if (purchases == null) {
            return null;
        }
        for (Purchase purchase : purchases) {
            if (purchase.getProducts().contains(COMMERCIAL_LICENSE_PRODUCT_ID)) {
                return purchase;
            }
        }
        return null;
    }

    private JSObject purchasePayload(Purchase purchase) {
        JSObject payload = new JSObject();
        payload.put("purchaseToken", purchase.getPurchaseToken());
        payload.put("purchaseState", purchase.getPurchaseState());
        payload.put("acknowledged", purchase.isAcknowledged());
        payload.put("orderId", purchase.getOrderId());
        payload.put("products", new JSArray(purchase.getProducts()));
        return payload;
    }

    private void withBillingReady(PluginCall call, BillingReadyAction action) {
        if (billingClient == null) {
            call.reject("Google Play Billing is not initialized.", "BILLING_NOT_INITIALIZED");
            return;
        }
        if (billingClient.isReady()) {
            action.run();
            return;
        }

        synchronized (this) {
            pendingBillingActions.add(new PendingBillingAction(call, action));
            if (connecting) {
                return;
            }
            connecting = true;
        }

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                List<PendingBillingAction> pending;
                synchronized (SloomPlayCommercePlugin.this) {
                    connecting = false;
                    pending = new ArrayList<>(pendingBillingActions);
                    pendingBillingActions.clear();
                }
                if (!isOk(result)) {
                    for (PendingBillingAction item : pending) {
                        rejectBilling(item.call, "Google Play Billing is unavailable.", result);
                    }
                    return;
                }
                for (PendingBillingAction item : pending) {
                    item.action.run();
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                synchronized (SloomPlayCommercePlugin.this) {
                    connecting = false;
                }
            }
        });
    }

    private boolean isOk(BillingResult result) {
        return result != null && result.getResponseCode() == BillingClient.BillingResponseCode.OK;
    }

    private JSObject billingResultPayload(BillingResult result) {
        JSObject payload = new JSObject();
        payload.put("responseCode", result == null ? -1 : result.getResponseCode());
        payload.put("debugMessage", result == null ? "" : result.getDebugMessage());
        return payload;
    }

    private void rejectBilling(PluginCall call, String message, BillingResult result) {
        String debugMessage = result == null ? "" : result.getDebugMessage();
        if (debugMessage != null && !debugMessage.isEmpty()) {
            message = message + " " + debugMessage;
        }
        call.reject(
            message,
            result == null ? "BILLING_ERROR" : "BILLING_" + result.getResponseCode()
        );
    }
}
