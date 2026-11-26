---
title: Portal guide
---

# Portal guide

The portal is where customers ask for help and follow their requests. It runs on its own hostname, separate from the staff app, and its pages sit at the root of that host. Customers never see internal fields, internal comments or other organisations' requests.

## Getting in

An administrator invites you by email. The invitation link opens `/invite/<id>`, where you set up your account. After that you sign in at `/sign-in`. If your organisation uses single sign-on, the sign-in page sends you to your company login instead. Use `/forgot-password` if you lose your password.

## Home

The home page shows your outstanding requests and counts. The sidebar links to Support (requests, catalogue, approvals, knowledge base), Announcements (with release notes as a second tab), Projects and Settings.

## Submit a request

1. Open the catalogue at `/catalogue`. It lists the request types your organisation can use.
2. Pick one and fill in the form. While you type, the portal may suggest knowledge base articles that answer the question.
3. Attach files if the form allows it, then submit.

You get a reference such as `SUB-7` and can open it any time at `/submissions/<ref>`.

## Track a request

`/requests` lists your requests with filters, and `/requests/<ref>` shows one. The detail page shows status, due time and the public conversation. You can:

- add comments and attachments;
- withdraw the request, before staff start triage;
- answer a clarification question from staff;
- raise its priority (you cannot lower it);
- reopen it within the reopen window after it is resolved;
- rate how it went once it is resolved.

You can also reorder your own open requests, and download the list as CSV (long lists are cut at a fixed row limit).

Whether you see only your own requests or all of your organisation's depends on the organisation's visibility setting.

## Approvals

`/approvals` lists decisions staff have asked you to make. Open one to approve or reject it. Rejections need a note, and a decision is final.

## Knowledge base, announcements and releases

`/kb` holds published help articles with search and a helpful or not helpful rating. `/announcements` lists notices from the service team, and `/releases` lists published release notes.

## Projects

`/projects` lists the projects your organisation has been given access to. Open one to see its details.

## Account

Account (`/account`, also reachable as `/settings`) holds your profile, password, two-factor setup and notification preferences. The bell shows portal notifications, with the full list at `/notifications`.
