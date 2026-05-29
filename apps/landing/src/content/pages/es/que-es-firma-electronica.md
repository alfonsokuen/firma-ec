---
title: "¿Qué es la firma electrónica? Definición, validez legal en Ecuador y cómo funciona"
description: "Firma electrónica explicada en lenguaje claro: qué es, qué validez tiene en Ecuador, cómo se diferencia de una imagen escaneada de tu firma, cómo se crea con un certificado .p12 y cuándo necesitas una firma electrónica certificada bajo la Ley 2002-67."
lang: es
datePublished: "2026-05-29"
dateModified: "2026-05-29"
h1: "Qué es la firma electrónica"
breadcrumbs:
  - { name: "Qué es la firma electrónica", url: "https://firmar.ec/que-es-firma-electronica/" }
related:
  - { title: "Firma electrónica vs firma digital: cuál es la diferencia", href: "/firma-electronica-vs-firma-digital/" }
  - { title: "Firma electrónica en Ecuador: marco legal", href: "/firma-electronica-ecuador/" }
  - { title: "ECIs autorizadas por ARCOTEL", href: "/comparativa-emisores-ecuador/" }
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
---

> **La firma electrónica es un conjunto de datos electrónicos que se adjunta a un documento digital para identificar al firmante y vincularlo de forma única al contenido firmado.** En Ecuador, cuando esa firma se genera con un certificado digital emitido por una **ECI acreditada por ARCOTEL**, tiene la **misma validez legal que una firma manuscrita** (Ley 2002-67 de Comercio Electrónico, Art. 14). No es una imagen escaneada de tu firma, ni un dibujo con el dedo, ni una foto: es criptografía verificable.

## Definición técnica

Una firma electrónica es el resultado de aplicar un **algoritmo criptográfico** (típicamente RSA o ECDSA con SHA-256) sobre el contenido de un documento, usando una **llave privada** que solo el firmante posee. El resultado es un bloque de bytes que se incrusta dentro del documento — en el caso de un PDF, dentro del propio archivo siguiendo el estándar **PAdES (PDF Advanced Electronic Signature)**.

Tres propiedades técnicas esenciales:

1. **Integridad.** Si el documento se modifica después de firmarlo —aunque sea un solo carácter—, la firma se invalida automáticamente al verificarla. Cualquier verificador puede detectarlo.
2. **Autenticidad.** La firma está vinculada al **certificado digital** del firmante (un archivo X.509 emitido por una autoridad de certificación). Quien recibe el documento puede verificar quién firmó.
3. **No repudio.** El firmante no puede negar que firmó, porque solo él posee la llave privada que produjo la firma. Esto solo es válido si la llave realmente nunca salió de su control — por eso importa cómo y dónde la guardas.

## Lo que NO es una firma electrónica (legal)

Estas cosas se confunden con firma electrónica pero **no tienen su mismo valor jurídico**:

- **Una imagen escaneada de tu firma manuscrita** pegada en un PDF. Esto es solo una imagen — no demuestra autoría ni integridad.
- **Un dibujo con el dedo o el mouse** en un PDF (estilo "firma con touch"). Mismo problema: no hay criptografía.
- **Escribir tu nombre al final de un email.** Es una manifestación de voluntad, pero no es firma electrónica certificada.
- **Una contraseña, PIN o código de un SMS.** Son mecanismos de autenticación, no de firma de documentos.
- **Adobe Sign, DocuSign, HelloSign** y similares usados sin un certificado ARCOTEL. Tienen valor entre partes que lo aceptan por contrato, pero **no equivalen a firma manuscrita** ante autoridad ecuatoriana.

Para que una firma electrónica **equivalga legalmente a una firma manuscrita en Ecuador**, debe ser una **firma electrónica certificada**: usar un certificado digital emitido por una **Entidad de Certificación de Información (ECI) acreditada por ARCOTEL**. La lista completa está en [ECIs acreditadas por ARCOTEL](/comparativa-emisores-ecuador/).

## Cómo funciona, paso a paso

Cuando firmas un PDF con tu certificado `.p12`:

1. **El software calcula un hash SHA-256** del contenido del PDF (un "huella digital" única).
2. **Tu llave privada cifra ese hash.** Solo tu llave puede producir el resultado correcto.
3. **El resultado cifrado + tu certificado público se incrustan** dentro del PDF, en una sección específica del archivo (`/ByteRange` + `/Contents`).
4. **El verificador**, al recibir el PDF, recalcula el hash y descifra la firma usando la llave pública incluida en tu certificado. Si coinciden → firma válida + documento íntegro.
5. **El verificador valida la cadena** de tu certificado hasta una raíz de confianza (ARCOTEL TSL), comprueba que no esté revocado (OCSP/CRL) y, si la firma incluye un sello de tiempo (TSA RFC 3161), confirma cuándo se firmó.

Todo este proceso ocurre **en tu propio dispositivo** cuando usas una herramienta como [firmar.ec](/) — tu llave privada nunca se envía a ningún servidor.

## Tipos de firma electrónica reconocidos en Ecuador

La Ley 2002-67 reconoce dos categorías:

- **Firma electrónica simple.** Cualquier mecanismo electrónico que identifique al firmante. Validez limitada — depende del acuerdo entre partes. Ejemplo: escribir tu nombre al final de un email pactado como vinculante por contrato.
- **Firma electrónica certificada.** La que usa un certificado emitido por una ECI acreditada por ARCOTEL. **Equivale legalmente a una firma manuscrita.** Es la que necesitas para SRI, ECUAPASS, Quipux, contratos formales y prueba en juicio.

Cuando alguien dice "firma electrónica" en Ecuador en contexto formal, casi siempre se refiere a la **certificada**.

## Cuándo necesitas una firma electrónica certificada

- Firmar **comprobantes del SRI** (factura electrónica, retenciones IR/IVA, formularios 103/104/107/101).
- Firmar **declaraciones aduaneras** en ECUAPASS / SENAE.
- Firmar documentos oficiales en **Quipux** del sector público.
- Firmar **contratos** que requieran fuerza probatoria de firma manuscrita.
- Presentar documentos firmados como **prueba en juicio**.
- Firmar **actas, balances y documentos corporativos** que se inscriban en el Registro Mercantil o la Superintendencia de Compañías.

## ¿Cuánto cuesta y cómo se obtiene?

Una firma electrónica certificada en Ecuador cuesta entre **USD 16 y USD 60** dependiendo de la ECI, la vigencia (1 a 3 años) y el formato (archivo `.p12` o token físico). La emisión típica toma **24–72 horas hábiles** tras la verificación de identidad. Detalles por proveedor en [comparativa de ECIs ARCOTEL](/comparativa-emisores-ecuador/) y la guía paso a paso en [cómo obtener un certificado](/como-obtener-certificado-firma-electronica/).

## ¿Cómo firmo después de obtener mi certificado?

Una vez tienes tu archivo `.p12` (con la contraseña que tú definiste durante la emisión), puedes firmar PDFs directamente en **[firmar.ec](https://app.firmar.ec)** — sin instalar Java, sin descargar software, también desde el celular. La aplicación es gratuita y open source (AGPL-3.0). Para casos en los que **necesitas FirmaEC del MINTEL** (XAdES del SRI, token USB físico), revisa la [comparación firmar.ec vs FirmaEC](/comparativos/firmaec/).

## Validez internacional

Las firmas electrónicas certificadas emitidas en Ecuador son **válidas internacionalmente** en jurisdicciones que reconocen el estándar PAdES (ETSI EN 319 142), incluyendo la Unión Europea bajo el reglamento eIDAS. Sin embargo, **el valor probatorio en cada país depende de sus tratados de reconocimiento mutuo** — un certificado ECI ecuatoriano puede no ser equivalente a un certificado eIDAS calificado en la UE para todos los efectos, aunque la verificación técnica funcione.

## Preguntas frecuentes

**¿Es lo mismo firma electrónica y firma digital?** No exactamente. En Ecuador la Ley 2002-67 habla de "firma electrónica"; "firma digital" es el término técnico para la implementación criptográfica subyacente. En la práctica se usan como sinónimos, pero hay matices importantes — los explicamos en [firma electrónica vs firma digital](/firma-electronica-vs-firma-digital/).

**¿La firma electrónica caduca?** El certificado caduca (1-3 años de vigencia), pero el documento firmado sigue siendo válido siempre que la firma haya sido válida al momento de firmarla. Una **firma PAdES B-LT / B-LTA** incluye la evidencia de validez al momento de firma, lo que la mantiene verificable indefinidamente.

**¿Puedo firmar desde el celular?** Sí, si tu certificado es archivo `.p12`. Abre [app.firmar.ec](https://app.firmar.ec) en el navegador del celular y carga tu PDF y tu `.p12`. No necesitas instalar nada.

**¿Y si pierdo mi `.p12`?** No hay forma de recuperarlo. La ECI no guarda tu llave privada (correctamente). Tendrás que solicitar la **revocación** del certificado perdido y emitir uno nuevo. Por eso es crucial respaldar tu `.p12` en un lugar seguro.

**¿Y si me roban mi `.p12`?** Solicita la **revocación inmediata** a tu ECI. Mientras esté revocado, las verificaciones online (OCSP/CRL) detectarán el robo y marcarán las firmas posteriores como inválidas. Las firmas anteriores con sello de tiempo siguen siendo válidas.

## Cómo verificar una firma electrónica que recibiste

Si te enviaron un PDF firmado y quieres comprobar que la firma es válida:

- Usa **[firmar.ec/verificar](https://app.firmar.ec/#/verificar)** — verificación offline + OCSP + CRL, gratuita.
- O Adobe Reader (panel "Firmas").
- O el **validador Minka del MINTEL** ([minka.gob.ec](https://minka.gob.ec)).

Los tres detectarán: si el documento fue alterado después de firmar, si el certificado del firmante está vigente, y si la firma tiene sello de tiempo válido.

---

**¿Listo para firmar?** Abre [app.firmar.ec](https://app.firmar.ec), carga tu PDF y tu `.p12`, y firma en menos de un minuto. La criptografía sucede 100% en tu dispositivo: tu llave privada nunca sale del navegador. Es gratis y open source.
