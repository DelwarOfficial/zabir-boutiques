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
3. WHEN an in-store order is created, THE Inventory_Engine SHALL reserve and confirm stock using the same reservation logic as the standard checkout flow.
4. WHEN an in-store order is created, THE Order_Service SHALL record the `created_by` field with the authenticated staff user ID.
5. WHEN an in-store order is created, THE Order_Service SHALL generate a system invoice number using the standard `ZB-YYYYMMDD-XXXXXX` order number format.
6. THE Order_Service SHALL NOT initiate UddoktaPay payment sessions for orders with `payment_method` equal to `in_store`.
7. THE Order_Service SHALL NOT invoke FraudBD checks for orders with `payment_method` equal to `in_store`.
8. WHEN an in-store order is created, THE Audit_System SHALL log the order creation event with the staff user ID, role, and order ID.
9. WHILE a staff user lacks Sales_Tier access, THE Staff_Dashboard SHALL deny access to the in-store order creation interface and API endpoint.

### Requirement 2: Owner-Tier Coupon Management

**User Story:** As the shop owner or super admin, I want to create and manage custom coupon codes, so that I can offer targeted promotions to customers.

#### Acceptance Criteria

1. WHEN an Owner_Tier user submits a coupon creation request, THE Coupon_Service SHALL create a new coupon record in the `coupons` table with the specified code, discount type, and parameters.
2. THE Coupon_Service SHALL support fixed-value coupon amounts of 5000, 10000, 15000, and 20000 Paisa (৳50, ৳100, ৳150, ৳200) for the initial implementation.
3. WHEN a coupon is created, THE Audit_System SHALL log a `coupon.create` event with the actor staff ID, role, and coupon ID.
4. WHEN a coupon is activated or deactivated, THE Audit_System SHALL log a `coupon.activate` or `coupon.deactivate` event with the actor staff ID, role, and coupon ID.
5. WHEN a coupon is used during checkout, THE Audit_System SHALL log a `coupon.use` event with the coupon ID and associated order ID.
6. WHILE a staff user lacks Owner_Tier access, THE RBAC_System SHALL return HTTP 403 for all coupon management API endpoints.
7. IF a non-Owner_Tier user attempts to access coupon management endpoints, THEN THE RBAC_System SHALL reject the request with error code `OWNER_ONLY`.
8. WHEN an Owner_Tier user requests the coupon usage history, THE Coupon_Service SHALL return the list of orders that applied the specified coupon code.

### Requirement 3: Staff-Assisted Phone Orders

**User Story:** As a salesman or higher-role staff member, I want to create orders on behalf of customers who contact us via phone, Messenger, or WhatsApp, so that remote customer orders are properly processed through the system.

#### Acceptance Criteria

1. WHEN a Sales_Tier staff member submits a phone order, THE Order_Service SHALL create an order record with the `created_by` field set to the authenticated staff user ID.
2. WHEN a phone order is submitted, THE Checkout_Engine SHALL apply the same server-authoritative pricing, inventory reservation, and coupon validation as the guest checkout flow.
3. WHEN a phone order is submitted, THE Checkout_Engine SHALL execute the FraudBD check against the customer phone number.
4. WHEN a phone order specifies `cod` as the payment method, THE Order_Service SHALL set the order status to `pending_review` following the standard COD workflow.
5. WHEN a phone order specifies `uddoktapay` as the payment method, THE Order_Service SHALL set the order status to `pending_payment` and initiate a UddoktaPay payment session.
6. THE Checkout_Engine SHALL validate the customer phone number using the same Bangladesh phone normalization as the guest checkout.
7. WHILE a staff user lacks Sales_Tier access, THE Staff_Dashboard SHALL deny access to the phone order creation interface and API endpoint.
8. WHEN a phone order is created, THE Audit_System SHALL log the order creation event including the staff user ID, the customer phone number, and the order channel (phone, messenger, whatsapp).

### Requirement 4: Mandatory Partial Prepayment Rule

**User Story:** As the shop owner, I want orders with more than two items to require a 50% advance payment, so that COD fraud risk is reduced for larger orders.

#### Acceptance Criteria

1. WHEN a checkout cart contains more than two distinct line items, THE Prepayment_Engine SHALL enforce a minimum 50% advance payment of the order total.
2. WHEN the prepayment rule applies, THE Checkout_Engine SHALL calculate the required advance amount as `ceil(total_paisa / 2)` using integer arithmetic with no floating-point operations.
3. WHEN the prepayment rule applies, THE Checkout_Engine SHALL initiate a UddoktaPay payment session for the calculated advance amount.
4. WHEN the prepayment rule applies, THE Checkout_Engine SHALL display the message: "Orders containing more than two items require a 50% advance payment to confirm the order. The remaining amount can be paid to the delivery person when receiving the parcel."
5. WHEN a prepaid advance payment is verified via UddoktaPay server-to-server verification, THE Order_Service SHALL update the order `payment_status` to reflect partial payment received.
6. THE Prepayment_Engine SHALL NOT apply the prepayment rule to orders with `payment_method` equal to `in_store`.
7. WHEN a staff-assisted phone order contains more than two distinct line items, THE Prepayment_Engine SHALL apply the same prepayment rule as the guest checkout.
8. WHEN a cart contains two or fewer distinct line items, THE Checkout_Engine SHALL allow the customer to choose between `cod` and `uddoktapay` without prepayment enforcement.
9. IF a customer abandons the prepayment flow, THEN THE Inventory_Engine SHALL release the reserved stock after the standard 30-minute reservation expiry.

### Requirement 5: Shipping Label Generation

**User Story:** As a staff member handling packing or shipping, I want to generate and download a shipping label for any order, so that I can quickly prepare parcels for courier dispatch.

#### Acceptance Criteria

1. WHEN a staff member clicks the "Print Label" button for an order, THE Label_Generator SHALL produce a downloadable image file in PNG or JPG format.
2. THE Label_Generator SHALL render the following fields on the label: customer name, mobile number, delivery address, order number, payment method, and COD or Partially Paid status.
3. THE Label_Generator SHALL produce labels with dimensions of approximately 210mm width by 99mm height, so that three labels fit vertically on a single A4 sheet.
4. THE Label_Generator SHALL generate labels entirely without external service dependencies, using either server-side rendering or client-side Canvas API.
5. THE Label_Generator SHALL optimize label layout for courier packaging readability with clear, legible font sizes.
6. WHILE a staff user lacks `orders.view` permission, THE Staff_Dashboard SHALL hide the "Print Label" button and deny access to the label generation endpoint.
7. WHEN a label is generated, THE Label_Generator SHALL use the delivery address, customer name, and phone number exactly as stored in the order record without modification.
