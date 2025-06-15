from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import numpy as np
import base64
import time
import io
import os

import torch.backends.cudnn as cudnn
import torch
import cv2
from PIL import Image

from emotion import detect_emotion, init
from models.experimental import attempt_load
from utils.general import check_img_size, non_max_suppression, scale_coords, set_logging
from utils.torch_utils import select_device

app = Flask(__name__)
CORS(app, origins="*")  # Allow all origins

# Global variables for models
face_model = None
device = None
stride = None
imgsz = 512
half = False

def initialize_models():
    """Initialize the face detection and emotion recognition models"""
    global face_model, device, stride, half
    
    # Initialize device
    device = select_device('')  # Use default device
    init(device)  # Initialize emotion model
    half = device.type != 'cpu'
    
    # Load face detection model
    face_model = attempt_load("weights/yolov7-tiny.pt", map_location=device)
    stride = int(face_model.stride.max())
    imgsz_checked = check_img_size(imgsz, s=stride)
    
    if half:
        face_model.half()
    
    # Warm up the model
    if device.type != 'cpu':
        face_model(torch.zeros(1, 3, imgsz_checked, imgsz_checked).to(device).type_as(next(face_model.parameters())))
    
    print(f"Models initialized on device: {device}")

def preprocess_image(image_array):
    """Preprocess image for face detection"""
    # Resize image while maintaining aspect ratio
    h, w = image_array.shape[:2]
    r = imgsz / max(h, w)
    if r != 1:
        interp = cv2.INTER_AREA if r < 1 else cv2.INTER_LINEAR
        image_array = cv2.resize(image_array, (int(w * r), int(h * r)), interpolation=interp)
    
    # Pad image to square
    h, w = image_array.shape[:2]
    dw, dh = imgsz - w, imgsz - h
    dw /= 2
    dh /= 2
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    image_array = cv2.copyMakeBorder(image_array, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
    
    # Convert to tensor
    img = image_array.transpose((2, 0, 1))[::-1]  # HWC to CHW, BGR to RGB
    img = np.ascontiguousarray(img)
    img = torch.from_numpy(img).to(device)
    img = img.half() if half else img.float()
    img /= 255.0
    if img.ndimension() == 3:
        img = img.unsqueeze(0)
    
    return img, image_array

def detect_faces_and_emotions(image_array, conf_thres=0.5, iou_thres=0.45, show_conf=True):
    """Detect faces and their emotions in an image"""
    original_img = image_array.copy()
    img, processed_img = preprocess_image(image_array)
    
    # Face detection
    with torch.no_grad():
        pred = face_model(img)[0]
        pred = non_max_suppression(pred, conf_thres, iou_thres)
    
    results = []
    
    for det in pred:
        if len(det):
            # Scale boxes back to original image size
            det[:, :4] = scale_coords(img.shape[2:], det[:, :4], original_img.shape).round()
            
            # Extract face images
            face_images = []
            face_boxes = []
            
            for *xyxy, conf, cls in det:
                x1, y1, x2, y2 = int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])
                face_img = original_img[y1:y2, x1:x2]
                if face_img.size > 0:  # Valid face region
                    face_images.append(face_img)
                    face_boxes.append([x1, y1, x2, y2])
            
            # Detect emotions for all faces
            if face_images:
                emotions = detect_emotion(face_images, show_conf)
                
                # Combine face boxes with emotions
                for i, (box, emotion_data) in enumerate(zip(face_boxes, emotions)):
                    results.append({
                        'box': box,  # [x1, y1, x2, y2]
                        'emotion': emotion_data[0],  # emotion label with confidence
                        'emotion_id': emotion_data[1],  # emotion class id
                        'confidence': float(conf) if i < len(det) else 0.0
                    })
    
    return results

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'device': str(device)})

@app.route('/detect', methods=['POST'])
def detect_endpoint():
    """Main detection endpoint that accepts an image and returns emotion detection results"""
    try:
        # Check if image is provided
        if 'image' not in request.files and 'image_base64' not in request.json:
            return jsonify({'error': 'No image provided'}), 400
        
        # Get parameters
        conf_thres = float(request.form.get('conf_thres', 0.5))
        iou_thres = float(request.form.get('iou_thres', 0.45))
        show_conf = request.form.get('show_conf', 'true').lower() == 'true'
        
        # Load image
        if 'image' in request.files:
            # Image uploaded as file
            image_file = request.files['image']
            image_bytes = image_file.read()
        else:
            # Image provided as base64
            image_base64 = request.json['image_base64']
            image_bytes = base64.b64decode(image_base64)
        
        # Convert to numpy array
        image = Image.open(io.BytesIO(image_bytes))
        image_array = np.array(image)
        
        # Convert RGB to BGR for OpenCV
        if len(image_array.shape) == 3 and image_array.shape[2] == 3:
            image_array = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
        
        # Detect faces and emotions
        start_time = time.time()
        results = detect_faces_and_emotions(image_array, conf_thres, iou_thres, show_conf)
        processing_time = time.time() - start_time
        
        return jsonify({
            'success': True,
            'detections': results,
            'processing_time': processing_time,
            'num_faces': len(results)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/detect_batch', methods=['POST'])
def detect_batch_endpoint():
    """Batch detection endpoint for multiple images"""
    try:
        if 'images_base64' not in request.json:
            return jsonify({'error': 'No images provided'}), 400
        
        images_base64 = request.json['images_base64']
        conf_thres = float(request.json.get('conf_thres', 0.5))
        iou_thres = float(request.json.get('iou_thres', 0.45))
        show_conf = request.json.get('show_conf', True)
        
        all_results = []
        start_time = time.time()
        
        for i, image_base64 in enumerate(images_base64):
            try:
                # Decode image
                image_bytes = base64.b64decode(image_base64)
                image = Image.open(io.BytesIO(image_bytes))
                image_array = np.array(image)
                
                # Convert RGB to BGR for OpenCV
                if len(image_array.shape) == 3 and image_array.shape[2] == 3:
                    image_array = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
                
                # Detect faces and emotions
                results = detect_faces_and_emotions(image_array, conf_thres, iou_thres, show_conf)
                all_results.append({
                    'image_index': i,
                    'detections': results,
                    'num_faces': len(results)
                })
                
            except Exception as e:
                all_results.append({
                    'image_index': i,
                    'error': str(e),
                    'detections': [],
                    'num_faces': 0
                })
        
        processing_time = time.time() - start_time
        
        return jsonify({
            'success': True,
            'results': all_results,
            'processing_time': processing_time,
            'total_images': len(images_base64)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Initializing emotion detection server...")
    set_logging()
    initialize_models()
    print("Server ready!")
    print("\nAPI Endpoints:")
    print("- GET  /health - Health check")
    print("- POST /detect - Single image detection")
    print("- POST /detect_batch - Batch image detection")
    app.run(host='0.0.0.0', port=5139, debug=True) 