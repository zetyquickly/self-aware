import requests
import base64
import cv2
import json
from PIL import Image
import io
import os

def encode_image_to_base64(image_path):
    """Encode an image file to base64 string"""
    with open(image_path, 'rb') as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def encode_cv2_image_to_base64(image_array):
    """Encode a cv2/numpy image array to base64 string"""
    _, buffer = cv2.imencode('.jpg', image_array)
    return base64.b64encode(buffer).decode('utf-8')

def test_single_detection(server_url, image_path):
    """Test single image detection"""
    print(f"Testing single detection with {image_path}")
    
    # Method 1: Upload as file
    with open(image_path, 'rb') as f:
        files = {'image': f}
        data = {
            'conf_thres': 0.5,
            'iou_thres': 0.45,
            'show_conf': 'true'
        }
        response = requests.post(f"{server_url}/detect", files=files, data=data)
    
    if response.status_code == 200:
        result = response.json()
        print(f"Success! Found {result['num_faces']} faces")
        print(f"Processing time: {result['processing_time']:.3f}s")
        for i, detection in enumerate(result['detections']):
            print(f"  Face {i+1}: {detection['emotion']} at {detection['box']}")
    else:
        print(f"Error: {response.status_code}, {response.text}")

def test_base64_detection(server_url, image_path):
    """Test detection with base64 encoded image"""
    print(f"Testing base64 detection with {image_path}")
    
    image_base64 = encode_image_to_base64(image_path)
    
    data = {
        'image_base64': image_base64,
        'conf_thres': 0.5,
        'iou_thres': 0.45,
        'show_conf': True
    }
    
    response = requests.post(f"{server_url}/detect", json=data)
    
    if response.status_code == 200:
        result = response.json()
        print(f"Success! Found {result['num_faces']} faces")
        print(f"Processing time: {result['processing_time']:.3f}s")
        for i, detection in enumerate(result['detections']):
            print(f"  Face {i+1}: {detection['emotion']} at {detection['box']}")
    else:
        print(f"Error: {response.status_code}, {response.text}")

def test_webcam_stream(server_url):
    """Test real-time webcam stream"""
    print("Testing webcam stream (press 'q' to quit)")
    
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Cannot open webcam")
        return
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Encode frame to base64
        image_base64 = encode_cv2_image_to_base64(frame)
        
        # Send to server
        data = {
            'image_base64': image_base64,
            'conf_thres': 0.5,
            'show_conf': True
        }
        
        try:
            response = requests.post(f"{server_url}/detect", json=data, timeout=1.0)
            
            if response.status_code == 200:
                result = response.json()
                
                # Draw results on frame
                for detection in result['detections']:
                    x1, y1, x2, y2 = detection['box']
                    emotion = detection['emotion']
                    
                    # Draw bounding box
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    
                    # Draw emotion label
                    cv2.putText(frame, emotion, (x1, y1-10), 
                              cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                # Show FPS info
                fps_text = f"Faces: {result['num_faces']}, Time: {result['processing_time']:.3f}s"
                cv2.putText(frame, fps_text, (10, 30), 
                          cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            
        except requests.exceptions.RequestException:
            cv2.putText(frame, "Server Error", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        
        # Display frame
        cv2.imshow('Emotion Detection Client', frame)
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    
    cap.release()
    cv2.destroyAllWindows()

def test_batch_detection(server_url, image_paths):
    """Test batch detection with multiple images"""
    print(f"Testing batch detection with {len(image_paths)} images")
    
    images_base64 = [encode_image_to_base64(path) for path in image_paths]
    
    data = {
        'images_base64': images_base64,
        'conf_thres': 0.5,
        'iou_thres': 0.45,
        'show_conf': True
    }
    
    response = requests.post(f"{server_url}/detect_batch", json=data)
    
    if response.status_code == 200:
        result = response.json()
        print(f"Batch processing completed in {result['processing_time']:.3f}s")
        
        for batch_result in result['results']:
            image_index = batch_result['image_index']
            num_faces = batch_result['num_faces']
            print(f"  Image {image_index}: {num_faces} faces detected")
            
            for detection in batch_result['detections']:
                print(f"    - {detection['emotion']} at {detection['box']}")
    else:
        print(f"Error: {response.status_code}, {response.text}")

if __name__ == '__main__':
    SERVER_URL = "http://localhost:5001"
    
    # Test server health
    try:
        response = requests.get(f"{SERVER_URL}/health")
        if response.status_code == 200:
            print("Server is healthy!")
            print(f"Device: {response.json()['device']}")
        else:
            print("Server health check failed")
            exit(1)
    except requests.exceptions.ConnectionError:
        print("Cannot connect to server. Make sure it's running on http://localhost:5000")
        exit(1)
    
    # Example usage
    print("\n" + "="*50)
    print("EMOTION DETECTION SERVER CLIENT EXAMPLES")
    print("="*50)
    
    # Test with example image if it exists
    if os.path.exists("example.png"):
        test_single_detection(SERVER_URL, "example.png")
        print()
        test_base64_detection(SERVER_URL, "example.png")
    else:
        print("example.png not found, skipping image tests")
    
    # Interactive menu
    while True:
        print("\n" + "-"*30)
        print("Choose an option:")
        print("1. Test with webcam stream")
        print("2. Test single image")
        print("3. Test batch processing")
        print("4. Exit")
        
        choice = input("Enter choice (1-4): ").strip()
        
        if choice == '1':
            test_webcam_stream(SERVER_URL)
        elif choice == '2':
            image_path = input("Enter image path: ").strip()
            if os.path.exists(image_path):
                test_single_detection(SERVER_URL, image_path)
            else:
                print("Image file not found")
        elif choice == '3':
            paths_input = input("Enter image paths (comma-separated): ").strip()
            image_paths = [p.strip() for p in paths_input.split(',')]
            valid_paths = [p for p in image_paths if os.path.exists(p)]
            if valid_paths:
                test_batch_detection(SERVER_URL, valid_paths)
            else:
                print("No valid image files found")
        elif choice == '4':
            break
        else:
            print("Invalid choice") 