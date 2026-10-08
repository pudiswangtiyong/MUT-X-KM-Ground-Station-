#pragma once
#include <Arduino.h>
#include "SD_MMC.h"
#include "Module_Camera.h"
#include "Config_Payload.h"
static bool _storageReady=false;
static String _lastImage=""; static size_t _lastImageSize=0; static uint32_t _imageCount=0;
inline bool storageModuleReady(){return _storageReady;}
inline uint32_t storageImageCount(){return _imageCount;}
inline String storageLastImage(){return _lastImage;}
inline size_t storageLastImageSize(){return _lastImageSize;}
inline String storageMakeFilename(uint32_t n){char b[32];snprintf(b,sizeof(b),"%s%04lu.JPG",PAYLOAD_IMAGE_PREFIX,(unsigned long)n);return String(b);}
inline void storageScan(){_imageCount=0;_lastImage="";_lastImageSize=0;File root=SD_MMC.open("/");if(!root)return;File f=root.openNextFile();while(f){String n=f.name(),u=n;u.toUpperCase();if(!f.isDirectory()&&u.endsWith(".JPG")){_imageCount++;_lastImage=n;if(!_lastImage.startsWith("/"))_lastImage="/"+_lastImage;_lastImageSize=f.size();}f=root.openNextFile();}}
inline bool storageModuleBegin(){_storageReady=SD_MMC.begin("/sdcard",true);if(_storageReady)storageScan();return _storageReady;}
inline bool storageCapture(String &filename,size_t &fileSize){filename="";fileSize=0;if(!_storageReady||!cameraModuleReady())return false;camera_fb_t*fb=cameraModuleGetFrame();if(!fb)return false;uint32_t next=_imageCount+1;String p=storageMakeFilename(next);while(SD_MMC.exists(p)){next++;p=storageMakeFilename(next);}File f=SD_MMC.open(p,FILE_WRITE);if(!f){cameraModuleReturnFrame(fb);return false;}size_t w=f.write(fb->buf,fb->len);f.close();cameraModuleReturnFrame(fb);if(!w)return false;_imageCount=next;_lastImage=p;_lastImageSize=w;filename=p;fileSize=w;return true;}
