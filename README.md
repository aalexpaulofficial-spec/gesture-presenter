# Gesture Presenter

Build a production-ready responsive web app called “PPT Hand Control” with a premium award-winning SaaS/competition website design. It must work beautifully on desktop, tablet, Android and iOS browsers.

STACK:

Frontend: React + TypeScript + Vite + Tailwind CSS.

Deployment: Vercel.

Backend: Python + FastAPI deployed separately on a Python-capable server.

PPT processing: Python backend using python-pptx and a reliable PPT/PPTX rendering pipeline.

Camera/AI: Browser MediaDevices API + MediaPipe Hands running locally in the user’s device.

Presentation control: Canvas/DOM overlay for a real-time laser pointer.

CORE PRODUCT:

Users upload ANY .ppt or .pptx presentation. Preserve the uploaded presentation’s original slide design, dimensions, text, images, fonts, positioning, colors and layout as accurately as technically possible. Never redesign the user's slides and never substitute demo slides.

FLOW:

1. Upload Presentation.

2. User selects PPT/PPTX.

3. Show:

   - Uploading file

   - Analyzing presentation

   - Generating preview

   Do NOT show “Converting slides”.

4. Start Presentation opens the presentation preview.

5. Request camera permission and automatically start the device’s available front-facing camera.

6. Show a small movable camera window so the presenter can minimize it.

7. Preview screen bottom controls should ONLY contain:

   Previous | Next | Enter Fullscreen | How to Control

8. Camera/hand-status controls must NOT appear in the bottom presentation controls.

9. When Enter Fullscreen is clicked, fullscreen should contain ONLY the presentation slide. No website header, buttons, camera box, browser-style controls or extra UI.

10. Camera continues running in the background while fullscreen presentation is active.

HAND CONTROLS:

- Open front palm → Next Slide.

- Back of hand/palm → Previous Slide.

- Raised index finger → Laser Pointer.

- Laser must be extremely responsive and smooth with minimal latency.

- Map the index fingertip across the ENTIRE presentation area: left, right, top and bottom.

- Wherever the real index fingertip moves, the laser must move to the corresponding position on the slide.

- Do not restrict the laser to a small central area.

- Correctly compensate for camera mirroring, aspect ratio, letterboxing and presentation scaling.

- Prevent jitter using lightweight smoothing without noticeable delay.

- Do not trigger slide changes repeatedly from one gesture.

- Clearly distinguish front palm, back palm and index-finger pointing.

- Handle different laptop/mobile cameras and different lighting conditions gracefully.

- Camera failure must show a useful permission/error message instead of a blank black camera.

PRESENTATION ENGINE:

The actual uploaded PPT/PPTX is the source of truth. Do not replace it with sample/demo content.

Keep slide order, dimensions and visual appearance intact.

Previous/Next must operate on the actual uploaded presentation.

Laser must be rendered as an overlay without modifying the original slide.

Fullscreen must preserve the presentation aspect ratio without cropping important content.

WEBSITE DESIGN:

Create a premium modern SaaS landing page inspired by high-quality award-winning product websites:

- clean white/light background

- strong typography

- premium green accent

- subtle gradients

- smooth animations

- polished cards

- professional product screenshots/mockups

- excellent spacing

- responsive navigation

- strong hero section

- “Present with your hands” messaging

- interactive product demonstration

- How It Works

- Features

- Why PPT Hand Control

- Hand Gesture Guide

- Pricing

- FAQ

- CTA

PRICING/BUSINESS MODEL:

FREE:

- Unlimited basic presentations

- Front Palm → Next Slide

- Back Palm → Previous Slide

- Index Finger → Laser Pointer

- Camera hand control

- Fullscreen presentation

- Browser-based usage

PRO:

- Larger presentation limits

- Advanced laser customization

- Gesture sensitivity controls

- Presentation session history

- Advanced presenter controls

- Custom branding

- Analytics

- Priority processing

BUSINESS/TEAM:

- Team accounts

- Admin dashboard

- Shared presentations

- Usage analytics

- Organization branding

- Higher limits

- Priority support

- Enterprise/security options

Keep the basic hand-control experience FREE. Design pricing so the free product is genuinely useful while advanced professional/team features are paid.

IMPORTANT:

Do not expose technical architecture, frameworks, Python, FastAPI, Vercel or implementation details anywhere on the public website.

Do not use Agrirakshak, Business Strategy or any fixed presentation as sample content.

Use generic presentation examples only.

Build the frontend, backend API structure, camera/MediaPipe integration, PPT/PPTX upload pipeline, gesture controls, laser overlay, fullscreen mode, responsive Android/iOS experience, and pricing/business model as one coherent production-ready application.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dac19aa1-789c-4dd1-b633-3380c8424d94).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
