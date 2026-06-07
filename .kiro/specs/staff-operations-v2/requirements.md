# Requirements Document

## Introduction

This specification covers five new staff/operations capabilities for the Zabir Boutiques F-commerce platform: in-store order creation, owner-tier coupon management, staff-assisted phone orders, mandatory partial prepayment enforcement, and shipping label generation. All capabilities integrate with the existing Astro + Cloudflare D1 architecture, RBAC system, inventory reservation engine, and audit logging infrastructure.

## Glossary

- **Staff_Dashboard**: The RBAC-protected staff interface served at `/staff`, accessible by authenticated staff users based on their role permissions.
- **Order_Service**: The server-side module responsible for creating, validating, and persisting orders in the D1 database, including inventory reservation and order item snapshots.
- **Checkout_Engine**: The server-authoritative checkout pipeline that validates carts, computes pricing from D1, applies coupons, runs fraud checks, reserves stock, and inserts order records.
- **Inventory_Engine**: The reservation-first inventory system that reserves stock via conditional D1 updates and releases reservations on failure or expiry.
- **Coupon_Service**: The server-side module responsible for creating, activating, deactivating, and atomically applying coupon codes against orders.
- **Prepayment_Engine**: The server-side logic that determines whether an order requires partial advance payment and calculates the required amount.
- **Label_Generator**: The component responsible for rendering and producing downloadable shipping label images for orders.
- **UddoktaPay_Gateway**: The payment integration that creates payment sessions and verifies payments via server-to-server API calls.
- **Audit_System**: The audit logging infrastructure that records staff mutations via `writeAuditLog()` into the `audit_log` table.
- **RBAC_System**: The role-based access control system enforcing permissions through a static in-memory matrix, with owner-tier roles receiving implicit full access.
- **Owner_Tier**: The set of roles (`super_admin`, `owner`) that have implicit full system access in the RBAC matrix.
- **Sales_Tier**: The set of roles (`super_admin`, `owner`, `manager`, `salesman`) authorized to create orders on behalf of customers.
- **Paisa**: The integer unit of currency used throughout the system (1 Taka = 100 Paisa). All monetary values are stored as non-negative integers.
- **Item_Count**: The total number of distinct product line items (rows) in an order, not the sum of quantities.

## Requirements

### Requirement 1: In-Store Order Creation

**User Story:** As a shop staff member, I want to create orders for walk-in customers through the staff dashboard, so that physical in-store sales are recorded in the system with proper inventory tracking.

#### Acceptance Criteria

1. WHEN a staff member with Sales_Tier access submits an in-store order, THE Order_Service SHALL create an order record with `payment_method` set to `in_store` and `status` set to `staff_confirmed`.
2. WHEN an in-store order is created, THE Order_Service SHALL skip the `pending_review` status and insert the order directly as `staff_confirmed`.
3. WHEN an in-store order is created, THE Inventory_Engine SHALL reserve and immediately confirm stock using the same reservation logic as the standard checkout flow, atomically decrementing both `reserved_quantity` and `quantity` in a single D1 batch.
4. WHEN an in-store order is created, THE Order_Service SHALL record the `created_by` field with the authenticated staff user ID.
5. WHEN an in-store order is created, THE Order_Service SHALL generate a system invoice number using the standard `ZB-YYYYMMDD-XXXXXX` order number format.
6. THE Order_Service SHALL NOT initiate UddoktaPay payment sessions for orders with `payment_method` equal to `in_store`.
7. THE Order_Service SHALL NOT invoke FraudBD checks for orders with `payment_method` equal to `in_store`.
8. WHEN an in-store order is created, THE Audit_System SHALL log the order creation event with action `orders.create_instore`, the staff user ID, role, and order ID.
9. WHILE a staff user lacks Sales_Tier access, THE Staff_Dashboard SHALL deny access to the in-store order creation interface and API endpoint by returning HTTP 403.
10. WHEN an in-store order is created, THE Order_Service SHALL set `delivery_paisa` to 0, since in-store orders have no delivery cost.
11. WHEN an in-store order is created, THE Order_Service SHALL set the `order_channel` field to `in_store`.

### Requirement 2: Owner-Tier Coupon Management

**User Story:** As the shop owner or super admin, I want to create and manage custom coupon codes, so that I can offer targeted promotions to customers.

#### Acceptance Criteria

1. WHEN an Owner_Tier user submits a coupon creation request with a valid code (3 to 30 alphanumeric characters, stored uppercase) and a permitted fixed-value amount, THE Coupon_Service SHALL create a new coupon record in the `coupons` table with the specified code, discount type of `fixed`, discount amount, optional usage limit, optional minimum order amount, and optional start/expiry dates, and SHALL set the coupon as active with a used_count of 0.
2. THE Coupon_Service SHALL support fixed-value coupon amounts of 5000, 10000, 15000, and 20000 Paisa (৳50, ৳100, ৳150, ৳200) for the initial implementation, and SHALL reject any amount not in this set with error code `INVALID_AMOUNT`.
3. WHEN a coupon is created, THE Audit_System SHALL log a `coupon.create` event with the actor staff ID, role, and coupon ID.
4. WHEN a coupon is activated or deactivated, THE Audit_System SHALL log a `coupon.activate` or `coupon.deactivate` event with the actor staff ID, role, and coupon ID.
5. WHEN a coupon is successfully applied during checkout (used_count atomically incremented), THE Audit_System SHALL log a `coupon.use` event with the coupon ID and associated order ID.
6. IF a non-Owner_Tier user attempts to access coupon management endpoints, THEN THE RBAC_System SHALL reject the request with HTTP 403 and error code `OWNER_ONLY`.
7. WHEN an Owner_Tier user requests the coupon usage history, THE Coupon_Service SHALL return up to 100 orders (most recent first) that applied the specified coupon code.
8. IF an Owner_Tier user submits a coupon creation request with a code that already exists in the `coupons` table, THEN THE Coupon_Service SHALL reject the request with error code `CODE_EXISTS` and HTTP 409.
9. IF an Owner_Tier user submits a coupon creation request with a code shorter than 3 characters or longer than 30 characters, THEN THE Coupon_Service SHALL reject the request with error code `INVALID_CODE` and HTTP 400.

### Requirement 3: Staff-Assisted Phone Orders

**User Story:** As a salesman or higher-role staff member, I want to create orders on behalf of customers who contact us via phone, Messenger, or WhatsApp, so that remote customer orders are properly processed through the system.

#### Acceptance Criteria

1. WHEN a Sales_Tier staff member submits a phone order, THE Order_Service SHALL create an order record with the `created_by` field set to the authenticated staff user ID and the `order_channel` field set to the submitted channel value.
2. WHEN a phone order is submitted, THE Checkout_Engine SHALL apply the same server-authoritative pricing, inventory reservation, and coupon validation as the guest checkout flow, accepting a maximum of 10 line items per order.
3. WHEN a phone order is submitted, THE Checkout_Engine SHALL execute the FraudBD check against the customer phone number in local 01XXXXXXXXX format and, IF the fraud decision is "blocked", THEN THE Checkout_Engine SHALL reject the order with an error indicating the order has been flagged.
4. WHEN a phone order specifies `cod` as the payment method and the cart contains 2 or fewer distinct items, THE Order_Service SHALL set the order status to `pending_review` following the standard COD workflow. IF the cart contains more than 2 distinct items, THEN THE Order_Service SHALL upgrade the payment method to `partial_prepay` and set the order status to `pending_payment`.
5. WHEN a phone order specifies `uddoktapay` as the payment method, THE Order_Service SHALL set the order status to `pending_payment` and initiate a UddoktaPay payment session.
6. WHEN a phone order is submitted, THE Checkout_Engine SHALL validate the customer phone number using the same Bangladesh phone normalization (conversion to +880 format) as the guest checkout and reject the order with an error indicating an invalid phone number if normalization fails.
7. WHILE a staff user lacks Sales_Tier access, THE Staff_Dashboard SHALL deny access to the phone order creation interface and API endpoint by returning HTTP 403 with an error indicating insufficient permissions.
8. WHEN a phone order is created, THE Audit_System SHALL log the order creation event including the staff user ID, the customer phone number, the order channel (phone, messenger, whatsapp), and the order number.
9. WHEN a phone order is submitted, THE Order_Service SHALL validate that the `channel` field is one of the permitted values (phone, messenger, whatsapp) and reject the request with an error indicating an invalid channel if the value is missing or unrecognized.

### Requirement 4: Mandatory Partial Prepayment Rule

**User Story:** As the shop owner, I want orders with more than two items to require a 50% advance payment, so that COD fraud risk is reduced for larger orders.

#### Acceptance Criteria

1. WHEN a checkout cart contains more than two distinct line items and `payment_method` is `cod`, THE Prepayment_Engine SHALL enforce a minimum 50% advance payment of the order total, where order total equals subtotal_paisa + delivery_paisa - discount_paisa.
2. WHEN the prepayment rule applies, THE Checkout_Engine SHALL calculate the required advance amount as `(total_paisa + 1) >> 1` using integer arithmetic with no floating-point operations, and set balance_paisa to `total_paisa - advance_paisa`.
3. WHEN the prepayment rule applies and `payment_method` is `cod`, THE Checkout_Engine SHALL upgrade the payment method to `partial_prepay` and set the order status to `pending_payment`, initiating a UddoktaPay payment session for the advance amount.
4. WHEN the prepayment rule applies, THE Checkout_Engine SHALL display the message: "Orders containing more than two items require a 50% advance payment to confirm the order. The remaining amount can be paid to the delivery person when receiving the parcel."
5. WHEN a prepaid advance payment is verified via UddoktaPay server-to-server verification, THE Order_Service SHALL update the order `payment_status` to `partial_paid` and record the verified `advance_paisa` amount against the order.
6. THE Prepayment_Engine SHALL NOT apply the prepayment rule to orders with `payment_method` equal to `in_store`.
7. WHEN a staff-assisted phone order contains more than two distinct line items, THE Prepayment_Engine SHALL apply the same prepayment rule as the guest checkout.
8. WHEN a cart contains two or fewer distinct line items, THE Checkout_Engine SHALL present both `cod` and `uddoktapay` as selectable payment methods without prepayment enforcement.
9. IF a customer abandons the prepayment flow, THEN THE Inventory_Engine SHALL release the reserved stock after 30 minutes from reservation creation, checked via the cron job that runs every 10 minutes.
10. IF UddoktaPay server-to-server verification fails or returns a non-success status for a partial_prepay order, THEN THE Order_Service SHALL retain the order in `pending_payment` status and preserve the inventory reservation until the 30-minute reservation expiry elapses.
11. IF the UddoktaPay payment session cannot be initiated due to a gateway error, THEN THE Checkout_Engine SHALL return an error response indicating payment gateway unavailability and SHALL NOT create an order row or reserve inventory.

### Requirement 5: Shipping Label Generation

**User Story:** As a staff member handling packing or shipping, I want to generate and download a shipping label for any order, so that I can quickly prepare parcels for courier dispatch.

#### Acceptance Criteria

1. WHEN a staff member clicks the "Print Label" button for an order, THE Label_Generator SHALL return a self-contained HTML document that auto-triggers the browser print dialog, with Content-Disposition set to inline with a filename derived from the order number.
2. THE Label_Generator SHALL render the following fields on the label: customer name, mobile number, delivery address, order number, payment method, and COD or Partially Paid status including advance amount paid and remaining balance due.
3. THE Label_Generator SHALL produce labels with dimensions of exactly 210mm width by 99mm height using CSS @page size, so that three labels fit vertically on a single A4 sheet (210mm × 297mm).
4. THE Label_Generator SHALL generate labels entirely without external service dependencies, using server-side HTML and CSS rendering with no runtime network calls to third-party services.
5. THE Label_Generator SHALL render customer name at minimum 16pt font size, phone number at minimum 14pt font size, and address at minimum 11pt font size, ensuring all text fields are legible at arm's length on a printed label.
6. WHILE a staff user lacks `orders.view` permission, THE Staff_Dashboard SHALL hide the "Print Label" button and deny access to the label generation endpoint with an HTTP 403 response.
7. WHEN a label is generated, THE Label_Generator SHALL use the delivery address, customer name, and phone number exactly as stored in the order record without modification.
8. IF the requested order ID does not exist in the database, THEN THE Label_Generator SHALL return an HTTP 404 response with an error message indicating the order was not found.
9. IF the order ID parameter is missing from the request, THEN THE Label_Generator SHALL return an HTTP 400 response with an error message indicating the missing order ID.
