#!/usr/bin/env python3
"""
Test script to verify user isolation and data persistence fixes in the RAG system.
Tests that deleted chat data doesn't return after refreshing or reloading.

Prerequisites:
- Backend server running on localhost:5000
- At least one test user account for Google OAuth
- Test conversations and messages

Updated to test the deletion fixes that prevent data from returning.
"""

import requests
import json
import time
from typing import Dict, List, Optional

# Configuration
BASE_URL = "http://localhost:5000/api"

class TestUserIsolation:
    def __init__(self):
        self.sessions = {}
        self.test_results = []
        
    def print_result(self, test_name: str, passed: bool, message: str = ""):
        """Print test result with formatting"""
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
        if message:
            print(f"   {message}")
        
        self.test_results.append({
            'test': test_name,
            'passed': passed,
            'message': message
        })
        print()
        
    def login_user(self, user_id: str, email: str, name: str) -> Optional[str]:
        """Simulate user login and return token"""
        try:
            # For testing, we'll use a mock token approach
            # In a real test, you'd need to implement actual OAuth flow
            session = requests.Session()
            
            # Mock login data - in real testing, get this from OAuth
            login_data = {
                "user_id": user_id,
                "email": email,
                "name": name
            }
            
            # Store session for this user
            self.sessions[user_id] = {
                'session': session,
                'headers': {
                    'Authorization': f'Bearer mock_token_{user_id}',
                    'Content-Type': 'application/json'
                },
                'user_data': login_data
            }
            
            print(f"✅ User {user_id} logged in successfully")
            return f'mock_token_{user_id}'
            
        except Exception as e:
            print(f"❌ Failed to login user {user_id}: {e}")
            return None
    
    def test_conversation_creation_with_auth(self, user_id: str) -> Optional[str]:
        """Test creating a conversation with proper authentication"""
        if user_id not in self.sessions:
            self.print_result(f"Create conversation for {user_id}", False, "User not logged in")
            return None
            
        try:
            session_data = self.sessions[user_id]
            
            # Don't send user_id in payload - let backend use JWT
            response = session_data['session'].post(
                f"{BASE_URL}/chat/conversations",
                json={"title": f"Test conversation for {user_id}"},
                headers=session_data['headers']
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    conv_id = data['conversation']['id']
                    self.print_result(
                        f"Create conversation for {user_id}", 
                        True, 
                        f"Created conversation: {conv_id}"
                    )
                    return conv_id
                    
            self.print_result(
                f"Create conversation for {user_id}", 
                False, 
                f"API error: {response.status_code} - {response.text}"
            )
            return None
            
        except Exception as e:
            self.print_result(f"Create conversation for {user_id}", False, f"Exception: {e}")
            return None
    
    def test_conversation_deletion_persistence(self, user_id: str, conv_id: str) -> bool:
        """Test that deleted conversations don't return after refresh/reload"""
        if user_id not in self.sessions:
            self.print_result(f"Delete persistence test for {user_id}", False, "User not logged in")
            return False
            
        try:
            session_data = self.sessions[user_id]
            
            # First, verify conversation exists
            response = session_data['session'].get(
                f"{BASE_URL}/chat/conversations",
                headers=session_data['headers']
            )
            
            if response.status_code != 200:
                self.print_result(f"Delete persistence test for {user_id}", False, "Failed to get conversations")
                return False
                
            conversations_before = response.json().get('conversations', [])
            conv_exists_before = any(conv['id'] == conv_id for conv in conversations_before)
            
            if not conv_exists_before:
                self.print_result(f"Delete persistence test for {user_id}", False, "Conversation doesn't exist")
                return False
            
            print(f"   Conversation {conv_id} exists before deletion")
            
            # Delete the conversation
            delete_response = session_data['session'].delete(
                f"{BASE_URL}/chat/conversations/{conv_id}",
                headers=session_data['headers']
            )
            
            if delete_response.status_code != 200:
                self.print_result(f"Delete persistence test for {user_id}", False, "Failed to delete conversation")
                return False
                
            delete_data = delete_response.json()
            if not delete_data.get('success'):
                self.print_result(f"Delete persistence test for {user_id}", False, "Delete API returned failure")
                return False
                
            print(f"   Conversation {conv_id} deleted successfully")
            
            # Wait a moment for deletion to propagate
            time.sleep(1)
            
            # Test multiple refresh scenarios
            scenarios = [
                "Immediate check",
                "After 2 seconds",
                "After cache-busting request"
            ]
            
            for i, scenario in enumerate(scenarios):
                if i == 1:
                    time.sleep(2)
                
                # Check if conversation still exists (simulating page refresh)
                headers = session_data['headers'].copy()
                if i == 2:
                    # Add cache-busting headers
                    headers.update({
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    })
                
                check_response = session_data['session'].get(
                    f"{BASE_URL}/chat/conversations?_t={int(time.time())}&_bust={i}",
                    headers=headers
                )
                
                if check_response.status_code == 200:
                    conversations_after = check_response.json().get('conversations', [])
                    conv_exists_after = any(conv['id'] == conv_id for conv in conversations_after)
                    
                    if conv_exists_after:
                        self.print_result(
                            f"Delete persistence test for {user_id}", 
                            False, 
                            f"Conversation returned after deletion ({scenario})"
                        )
                        return False
                    else:
                        print(f"   ✅ {scenario}: Conversation stays deleted")
                else:
                    self.print_result(
                        f"Delete persistence test for {user_id}", 
                        False, 
                        f"Failed to check conversations ({scenario})"
                    )
                    return False
            
            self.print_result(
                f"Delete persistence test for {user_id}", 
                True, 
                "Conversation stays deleted across all refresh scenarios"
            )
            return True
            
        except Exception as e:
            self.print_result(f"Delete persistence test for {user_id}", False, f"Exception: {e}")
            return False
    
    def test_bulk_delete_persistence(self, user_id: str) -> bool:
        """Test that bulk deleted conversations don't return"""
        if user_id not in self.sessions:
            self.print_result(f"Bulk delete persistence test for {user_id}", False, "User not logged in")
            return False
            
        try:
            session_data = self.sessions[user_id]
            
            # Create multiple test conversations
            conv_ids = []
            for i in range(3):
                conv_id = self.test_conversation_creation_with_auth(user_id)
                if conv_id:
                    conv_ids.append(conv_id)
            
            if len(conv_ids) < 3:
                self.print_result(f"Bulk delete persistence test for {user_id}", False, "Failed to create test conversations")
                return False
            
            print(f"   Created {len(conv_ids)} test conversations for bulk delete test")
            
            # Perform bulk delete
            bulk_response = session_data['session'].delete(
                f"{BASE_URL}/chat/conversations/bulk-delete",
                headers=session_data['headers']
            )
            
            if bulk_response.status_code != 200:
                self.print_result(f"Bulk delete persistence test for {user_id}", False, "Bulk delete request failed")
                return False
                
            bulk_data = bulk_response.json()
            if not bulk_data.get('success'):
                self.print_result(f"Bulk delete persistence test for {user_id}", False, "Bulk delete API returned failure")
                return False
                
            deleted_count = bulk_data.get('deleted_count', 0)
            print(f"   Bulk delete reported {deleted_count} conversations deleted")
            
            # Wait for deletion to propagate
            time.sleep(2)
            
            # Check if any conversations still exist after bulk delete
            check_response = session_data['session'].get(
                f"{BASE_URL}/chat/conversations?_t={int(time.time())}",
                headers={
                    **session_data['headers'],
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            )
            
            if check_response.status_code == 200:
                conversations_after = check_response.json().get('conversations', [])
                
                if len(conversations_after) == 0:
                    self.print_result(
                        f"Bulk delete persistence test for {user_id}", 
                        True, 
                        f"All conversations deleted and stay deleted (checked {len(conv_ids)} conversations)"
                    )
                    return True
                else:
                    remaining_ids = [conv['id'] for conv in conversations_after]
                    test_convs_remaining = [cid for cid in conv_ids if cid in remaining_ids]
                    
                    if test_convs_remaining:
                        self.print_result(
                            f"Bulk delete persistence test for {user_id}", 
                            False, 
                            f"Some test conversations returned after bulk delete: {test_convs_remaining}"
                        )
                        return False
                    else:
                        self.print_result(
                            f"Bulk delete persistence test for {user_id}", 
                            True, 
                            f"Test conversations deleted, {len(conversations_after)} other conversations remain"
                        )
                        return True
            else:
                self.print_result(f"Bulk delete persistence test for {user_id}", False, "Failed to check conversations after bulk delete")
                return False
                
        except Exception as e:
            self.print_result(f"Bulk delete persistence test for {user_id}", False, f"Exception: {e}")
            return False
    
    def test_cross_user_isolation_after_deletion(self) -> bool:
        """Test that deleted data from one user doesn't appear for another user"""
        try:
            # Test with two users
            user1_conv = self.test_conversation_creation_with_auth("test_user_1")
            user2_conv = self.test_conversation_creation_with_auth("test_user_2")
            
            if not user1_conv or not user2_conv:
                self.print_result("Cross-user isolation after deletion", False, "Failed to create test conversations")
                return False
            
            # Delete user1's conversation
            if not self.test_conversation_deletion_persistence("test_user_1", user1_conv):
                self.print_result("Cross-user isolation after deletion", False, "Failed to delete user1's conversation")
                return False
            
            # Check that user2 still has their conversation and doesn't see user1's deleted conversation
            session_data = self.sessions["test_user_2"]
            response = session_data['session'].get(
                f"{BASE_URL}/chat/conversations",
                headers=session_data['headers']
            )
            
            if response.status_code == 200:
                conversations = response.json().get('conversations', [])
                
                # User2 should have their conversation
                user2_has_conv = any(conv['id'] == user2_conv for conv in conversations)
                # User2 should NOT have user1's deleted conversation
                user2_has_user1_conv = any(conv['id'] == user1_conv for conv in conversations)
                
                if user2_has_conv and not user2_has_user1_conv:
                    self.print_result(
                        "Cross-user isolation after deletion", 
                        True, 
                        "User2 has own conversation, doesn't see user1's deleted conversation"
                    )
                    return True
                else:
                    self.print_result(
                        "Cross-user isolation after deletion", 
                        False, 
                        f"User2 conv: {user2_has_conv}, User1 deleted conv visible: {user2_has_user1_conv}"
                    )
                    return False
            else:
                self.print_result("Cross-user isolation after deletion", False, "Failed to get user2's conversations")
                return False
                
        except Exception as e:
            self.print_result("Cross-user isolation after deletion", False, f"Exception: {e}")
            return False
    
    def run_all_tests(self):
        """Run comprehensive test suite for deletion persistence"""
        print("🚀 Starting Enhanced User Isolation and Deletion Persistence Tests")
        print("=" * 70)
        
        # Setup test users
        test_users = [
            ("test_user_1", "test1@example.com", "Test User 1"),
            ("test_user_2", "test2@example.com", "Test User 2"),
        ]
        
        # Login users
        print("📝 Setting up test users...")
        for user_id, email, name in test_users:
            token = self.login_user(user_id, email, name)
            if not token:
                print(f"❌ Failed to setup user {user_id}, skipping tests")
                return
        
        print("\n🧪 Running deletion persistence tests...\n")
        
        # Test 1: Individual conversation deletion persistence
        conv_id = self.test_conversation_creation_with_auth("test_user_1")
        if conv_id:
            self.test_conversation_deletion_persistence("test_user_1", conv_id)
        
        # Test 2: Bulk deletion persistence
        self.test_bulk_delete_persistence("test_user_1")
        
        # Test 3: Cross-user isolation after deletion
        self.test_cross_user_isolation_after_deletion()
        
        # Summary
        print("\n" + "=" * 70)
        print("📊 TEST SUMMARY")
        print("=" * 70)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result['passed'])
        failed_tests = total_tests - passed_tests
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_tests}")
        print(f"❌ Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests*100):.1f}%")
        
        if failed_tests > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result['passed']:
                    print(f"   - {result['test']}: {result['message']}")
        
        return failed_tests == 0

if __name__ == "__main__":
    print("🔍 Enhanced User Isolation and Deletion Persistence Test Suite")
    print("This script tests that deleted chat data doesn't return after refresh/reload")
    print()
    
    tester = TestUserIsolation()
    success = tester.run_all_tests()
    
    if success:
        print("\n🎉 All tests passed! Deletion persistence is working correctly.")
    else:
        print("\n⚠️  Some tests failed. Check the deletion logic and data cleanup.")
        exit(1) 