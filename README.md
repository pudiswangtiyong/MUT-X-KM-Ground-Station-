# SunSeek Ground Station

Web Ground Station สำหรับ ESP32-S3 SunSeek Platform v3.0.7 และ ESP32-CAM Payload v3.0 ตามไฟล์ที่ให้มา มี Engineering / Operation / Competition, BLE TTC, Wi-Fi MJPEG, ภารกิจหลายเป้าหมาย, โปรไฟล์, Filter/Fusion, กราฟ, CSV และภาพจาก SD card

## เปิดใช้งาน

ต้องมี Python 3 และ Chrome/Edge ที่รองรับ Web Bluetooth

```sh
cd /Users/pudiswangtiyong/Desktop/webbasewthcamera
python3 server.py
```

เปิด http://localhost:8080 ใน Chrome/Edge (หรือดับเบิลคลิก `Start-GroundStation.command` บน macOS / `Start-GroundStation.bat` บน Windows)

เฟิร์มแวร์กล้อง v3.0 เดิมใช้ server นี้เพื่อ camera relay; ส่วนเว็บ Vercel ใช้กล้องโดยตรงได้หลังอัปเดตเฟิร์มแวร์กล้อง Web v3.0.1 เซิร์ฟเวอร์รับเฉพาะเครื่องนี้บน loopback และส่งต่อเฉพาะ endpoint กล้องที่อนุญาตในเครือข่าย private

## เชื่อมบอร์ดจริง

1. Flash เฟิร์มแวร์ต้นฉบับที่ให้มาให้ตรงบอร์ดและตั้งค่าเซนเซอร์/กล้องตามฮาร์ดแวร์
2. ต่อ UART: ESP32-S3 GPIO41 TX → ESP32-CAM GPIO3 RX; GPIO42 RX ← GPIO1 TX และ GND ร่วมกัน (115200 baud) ตาม Config_Payload.h
3. ต่อคอมพิวเตอร์กับ Wi-Fi `SUNSEEK-PAYLOAD` รหัส `sunseek01` ตาม Config_Payload.h ของกล้อง
4. กด TTC CONNECT และเลือก SUNSEEK ในหน้าต่าง Bluetooth ของเบราว์เซอร์ อนุญาต Bluetooth ของระบบปฏิบัติการ
5. กด DATA LINK CONNECT เว็บอ่าน PAYLOAD_IP จาก BLE และลอง gateway 192.168.4.1 อัตโนมัติ ไม่ต้องกรอก IP; ชื่อ .local จะใช้งานได้เมื่อบอร์ดตั้ง mDNS เพิ่มเอง (เฟิร์มแวร์ต้นฉบับยังไม่ได้ตั้ง)
6. ตรวจว่า telemetry ปรากฏและ Estimator VALID ก่อนทำภารกิจ กล้องต้องมี SD card ที่พร้อมเพื่อ CAPTURE

เว็บไม่สามารถสลับ Wi-Fi ของ OS ให้เองได้ และไม่ใช้ Bluetooth Classic SPP; ใช้ BLE Nordic UART UUID เดียวกับ System_TTC.h

## ใช้งาน

- **Engineering:** PING, STATUS, MISSION STATUS, PAYLOAD STATUS, RW STOP, ส่ง raw command, เลือก SUN/MAG reference, เปิด/ปิด sensor telemetry, ตั้ง 1–20 Hz และ snapshot
- **Filter/Fusion:** MOVING_AVERAGE / LPF / CUSTOM, filter on/off, window, strength, fusion on/off, gyro weight ส่งคำสั่งจริงและรอ ACK; CUSTOM ใช้พฤติกรรมที่เฟิร์มแวร์กำหนด
- **Profiles:** เริ่มต้นไม่มีโปรไฟล์ที่บันทึกไว้ ใช้ค่าบนหน้าจอได้ทันที; SAVE AS สร้างโปรไฟล์ใหม่ และ DELETE ALL ลบทั้งหมดโดยไม่สร้าง preset กลับมาอัตโนมัติ; โหลด/บันทึก/Save As, จัดการ, import/export JSON เก็บใน localStorage; LOAD ใน Operation ส่ง configuration ไปบอร์ด และ SAVE เก็บในเครื่อง
- **Operation:** MANUAL, PD config, RW −100…100%, TEST AUTO (target 30°), Prepare / Run / Abort, telemetry และกล้อง
- **Competition:** SUN target −90…90° หรือ MAG 0…359°, สูงสุด 10 เป้าหมาย, tolerance 0.1…30°, hold 0…60s, ถ่ายหลังแต่ละเป้าหมาย และเลือกโอนภาพทันทีหรือโอนทั้งหมดหลังจบภารกิจ
- **Camera:** START LIVE ส่ง PAYLOAD_STREAM_START ผ่าน BLE; STOP ส่ง PAYLOAD_STREAM_STOP; CAPTURE ส่งผ่าน BLE แล้วรอ PAYLOAD,IMAGE_READY ก่อนดาวน์โหลดภาพจริงทาง /image?name=...
- **Images:** REFRESH โหลดรายการและไฟล์จาก SD card; คลิก thumbnail เพื่อดูรายละเอียดและ DOWNLOAD; ภาพเก็บเป็น Blob แยกแต่ละภาพ ไม่ใช่ URL latest ที่เปลี่ยนทุกรอบ
- **Plot/log:** เลือกเส้น, window, pause/resume, clear, กรอง TTC log, export TXT, Start Log → Stop / CSV
- **Simulator:** ทดสอบหน้าจอและภารกิจด้วย telemetry/ภาพจำลอง มีสถานะ SIMULATED ชัดเจนและไม่มีคำสั่งส่งไปฮาร์ดแวร์

## การออกแบบและข้อจำกัดที่ต้องทราบ

TTC ใช้ newline framing และแบ่ง write 20 bytes ให้เข้ากับ ATT MTU; คำสั่งตั้งค่ารอ ACK/ERR ก่อนขั้นต่อไป ข้อมูล TM เป็น flat key/value ตาม System_Telemetry.h ภารกิจบนเว็บใช้ estimator angle ล่าสุดตรวจ tolerance และ hold ต่อเนื่อง พร้อม time limit, cancellation และ stop เมื่อผิดพลาด ไม่ใช้ native MISSION_START เพราะ Module_Mission.h ที่ให้มาไม่เปลี่ยน target เมื่อ AUTO ยังเปิดอยู่หลังเป้าหมายแรก

Live stream ในกล้องใช้ HTTP server เดียว จึงหยุด stream ผ่าน BLE ก่อน CAPTURE, โหลด SD images หรือเริ่มภารกิจ ไม่เปิดสอง stream พร้อมกัน

เฟิร์มแวร์นี้รองรับ SUN/MAG reference เท่านั้น ไม่มี GYRO reference, SUN_SEARCH, ZERO หรือ POINT ตาม HTML เดิม ปุ่ม SET TARGET = 0° ตั้ง target ศูนย์ ไม่ได้เปลี่ยน gyro zero

เมื่อ BLE หลุด เว็บพยายามยกเลิกภารกิจ แต่ไม่สามารถส่ง RW_STOP ผ่านลิงก์ที่ขาดได้ เฟิร์มแวร์ต้นฉบับไม่ได้หยุด actuator เมื่อ BLE disconnect; การหยุดบนฮาร์ดแวร์เมื่อขาดลิงก์ต้องเพิ่ม failsafe ในเฟิร์มแวร์หรือใช้สวิตช์หยุดจริง ปิดแท็บ/เครื่องขณะ AUTO อาจทำให้ controller เดิมทำงานต่อ จึงควรกด ABORT / RW STOP ก่อนปิด

ผลทดสอบซอฟต์แวร์ไม่เท่ากับการทดสอบฮาร์ดแวร์ 100% ยังต้องตรวจ BLE, UART, เซนเซอร์, motor, SD card, camera และ timing กับบอร์ดจริง

## ทดสอบ

ติดตั้ง Node.js และ Playwright แล้วเปิด server.py ก่อน:

```sh
npm install
npm test
```

Tests ใช้ isolated headless Chrome; firmware-contract.cjs ใช้ BLE/HTTP mock ตามเฟิร์มแวร์ ไม่เชื่อมบอร์ดจริง ตรวจ ACK, TM, discovery, CAPTURE, ERR, stale estimator และ UI simulator

อ้างอิง browser: [Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth), [Local network access](https://developer.chrome.com/blog/local-network-access)

## ช่องกล้องและเวลา

กล้องทั้ง Operation และ Competition มีเส้นกากบาทตรงกลางภาพ ภาพหมุน −90° เป็นค่าเริ่มต้น พร้อมปุ่มสลับกลับ 0° และปรับขนาดให้พอดีกรอบ การหมุนมีผลกับการแสดงภาพในเว็บ โดยไฟล์ภาพที่ดาวน์โหลดคงข้อมูลต้นฉบับ

เมื่อ PREPARE สำเร็จ เวลาที่ใช้จะรีเซ็ตเป็น `00:00.000` เวลาคงเหลือจะเริ่มใหม่ตาม Maximum Mission Duration และสถานะกลับเป็น READY


## ปรับเวลา Competition และการตรวจโค้ด

ใน Maximum Mission Duration เลือกเวลาสำเร็จรูป หรือ Custom · กำหนดเอง แล้วระบุนาทีและวินาที รวมได้ตั้งแต่ 1 วินาทีถึง 60 นาที นาฬิกาแสดงค่าทันที เมื่อเปลี่ยนเวลาต้อง PREPARE อีกครั้ง ระหว่าง PREPARE/ภารกิจ ช่องตั้งค่าจะถูกล็อก เมื่อครบเวลาเว็บยกเลิกงานที่รออยู่และส่ง MISSION_ABORT / RW_STOP ผ่าน TTC ที่ยังเชื่อมต่อ

ตัวจับเวลาใช้ performance.now() เพื่อลดผลจากการปรับนาฬิกาของเครื่อง หยุดนับหลังจบหรือยกเลิก และ PREPARE สำเร็จจะเริ่มเวลาใหม่ที่ศูนย์

ปรับ log ให้แสดงแบบรวมชุด ลดการเขียน DOM ซ้ำ วาดกราฟเฉพาะเมื่อมีข้อมูลใหม่และกราฟปรากฏ จำกัดประวัติ telemetry และตรวจข้อมูล NaN ก่อนถือว่า estimator ยังมีข้อมูลสด แก้การยกเลิกระหว่างรอ ACK/ภาพและ timeout ของ HTTP โดย BLE จะส่งเฟรมที่เริ่มแล้วให้จบบรรทัดก่อนส่งคำสั่งถัดไป

`npm test` รวมชุดทดสอบ Competition time แล้ว ส่วน relay validation ใช้ `npm run test:server` (ต้องมี Python 3)


## Vercel deployment

Vercel ใช้ `vercel.json` และ `node build.cjs` เพื่อเผยแพร่ index.html, styles.css, app.js และแพ็กเกจเฟิร์มแวร์กล้องจาก dist โดยไม่เผยแพร่ไฟล์ server หรือ tests เว็บไซต์ HTTPS ใช้ Simulator และ Web Bluetooth บน browser/OS ที่รองรับได้

เว็บ Vercel เชื่อมกล้องตรงจาก browser ของผู้ใช้ ไม่ผ่าน Vercel server หรือ Python relay ใช้ Chrome/Edge ปัจจุบันและอนุญาต Local Network Access กล้อง v3.0 เดิมไม่มี CORS จึงต้องอัปเดต ESP32-CAM หนึ่งครั้งด้วย firmware/SunSeek_ESP32CAM_Web_v3_0_1 ก่อน ดู README_WEB.md ในแพ็กเกจหรือดาวน์โหลดจากลิงก์บนหน้าเว็บ ไม่ต้องเปลี่ยนเฟิร์มแวร์ ESP32-S3 TTC

โปรโตคอล Local Network Access: https://developer.chrome.com/blog/local-network-access
