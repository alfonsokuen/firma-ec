---
question: "Does verification detect revoked certificates?"
lang: en
order: 9
tags: [verification, ocsp]
---

Yes. The verifier queries OCSP (RFC 6960) in real time against the responder of the certificate's issuing CA. If the CA does not expose OCSP or is temporarily unreachable, we display a clear warning in the verification report, distinguishing between "OCSP unavailable" and "certificate revoked".
